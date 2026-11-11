import mongoose from 'mongoose'
import { newCloneCtx, cloneAgentForUser, finishStoryGraph, rollbackClaim } from './own/cloneForClaim.js'
import newestWorkspaceIdForUser from './newestWorkspaceIdForUser.js'
import logger from './logger.js'

const { ObjectId } = mongoose.Types

function remapStepsGotoScreen(steps, remapGotoScreen) {
  return (steps || []).map(step => {
    const buttons = step?.view?.popup?.buttons
    if (!buttons?.length) return step

    return {
      ...step,
      view: {
        ...step.view,
        popup: {
          ...step.view.popup,
          buttons: buttons.map(button => ({
            ...button,
            gotoScreen: remapGotoScreen(button.gotoScreen)
          }))
        }
      }
    }
  })
}

function remapTransitionsGotoScreen(transitions, remapGotoScreen) {
  return (transitions || []).map(transition => ({
    ...transition,
    gotoScreen: remapGotoScreen(transition.gotoScreen)
  }))
}

export async function cloneStoryForUser(storyId, userId, workspaceId, Models) {
  const storyDoc = await Models.Story.findById(storyId).populate('screens').lean()
  if (!storyDoc) return null

  const newStoryId = new ObjectId()
  const oldScreens = storyDoc.screens || []

  // Pre-generate new screen ids up front so gotoScreen references (which point
  // at a screen's `index` field) can be remapped to the screen sharing that
  // same `index` value in the cloned list before the screens are saved.
  const newScreenIds = oldScreens.map(() => new ObjectId())
  const firstNewScreenId = newScreenIds[0] || null

  const oldScreenIdToScreenIndex = new Map(
    oldScreens.map(screen => [screen._id.toString(), screen.index])
  )
  const newScreenIdByScreenIndex = new Map(
    oldScreens.map((screen, i) => [screen.index, newScreenIds[i]])
  )

  const remapGotoScreen = (gotoScreenId) => {
    if (!gotoScreenId) return gotoScreenId

    const screenIndex = oldScreenIdToScreenIndex.get(gotoScreenId.toString())
    const newScreenId = newScreenIdByScreenIndex.get(screenIndex)

    return newScreenId || firstNewScreenId
  }

  const screenPromises = oldScreens.map((screen, index) => {
    return new Models.Screen({
      ...screen,
      _id: newScreenIds[index],
      storyId: newStoryId,
      workspaceId: workspaceId,
      userId: userId,
      steps: remapStepsGotoScreen(screen.steps, remapGotoScreen),
      customTransitions: remapTransitionsGotoScreen(screen.customTransitions, remapGotoScreen)
    }).save()
  })

  const savedScreens = await Promise.all(screenPromises)
  const screenIds = savedScreens.map(s => s._id)

  await new Models.Story({
    ...storyDoc,
    _id: newStoryId,
    userId: userId,
    workspaceId: workspaceId,
    screens: screenIds
  }).save()

  if (workspaceId) {
    await Models.Workspace.findByIdAndUpdate(workspaceId, {
      $push: { liveDemos: newStoryId }
    })
  }

  return newStoryId
}

const CLONE_DEPS = { newCloneCtx, cloneAgentForUser, finishStoryGraph, rollbackClaim }

// Copy of a UrlDemo agent into the user's workspace: the agent, its demo story and its knowledge.
// deps is only replaced by the check file
export async function cloneUrlDemoAgentForUser(sourceUrlDemo, userId, workspaceId, browserSessionId, Models, deps = CLONE_DEPS) {
  const sourceAgent = await Models.AiDemoAgent.findOne({ _id: sourceUrlDemo.agentId, deletedAt: null })
    .select('workspaceId cta')
    .lean()
  if (!sourceAgent) return null

  const ctx = deps.newCloneCtx({
    Models,
    userId,
    workspaceId,
    sourceWorkspaceId: sourceAgent.workspaceId
  })
  try {
    const newAgentId = await deps.cloneAgentForUser(sourceAgent._id, ctx, { includeKnowledge: true })
    const newStoryId = ctx.storyIdMap.get(String(sourceUrlDemo.storyId))
    if (!newAgentId || !newStoryId) throw new Error('UrlDemo agent copy is incomplete')

    await deps.finishStoryGraph(ctx)
    // cloneAgentForUser clears the CTA links and unpublishes ("Make it yours" rules). These links are ours, not
    // an author's, and UrlDemo agents are published from the start so the preview page can iframe the player
    await Models.AiDemoAgent.updateOne({ _id: newAgentId }, { $set: { cta: sourceAgent.cta, isPublished: true } })

    return await new Models.UrlDemo({
      url: sourceUrlDemo.url,
      browserSessionId: browserSessionId || sourceUrlDemo.browserSessionId,
      type: 'owned',
      demoType: 'agent',
      storyId: newStoryId,
      agentId: newAgentId,
      status: 'completed',
      userId
    }).save()
  } catch (err) {
    await deps.rollbackClaim(ctx).catch(rollbackErr => logger.error('[cloneUrlDemoAgentForUser] rollback failed', { eventName: 'CLONE_URL_DEMO_AGENT_ROLLBACK_FAILED', err: rollbackErr }))
    throw err
  }
}

export async function cloneUrlDemoWithStoryForUser(sourceUrlDemo, userId, workspaceId, browserSessionId, Models) {
  if (!sourceUrlDemo?.storyId) return null
  if (sourceUrlDemo.demoType === 'agent') return cloneUrlDemoAgentForUser(sourceUrlDemo, userId, workspaceId, browserSessionId, Models)

  const newStoryId = await cloneStoryForUser(sourceUrlDemo.storyId, userId, workspaceId, Models)
  if (!newStoryId) return null

  return new Models.UrlDemo({
    url: sourceUrlDemo.url,
    browserSessionId: browserSessionId || sourceUrlDemo.browserSessionId,
    type: 'owned',
    storyId: newStoryId,
    status: 'completed',
    userId: userId,
  }).save()
}

/**
 * Finds all completed UrlDemos linked to browserSessionId that have no userId,
 * clones their storyDocs into the user's first workspace, and creates owned UrlDemos for the user.
 */
export async function cloneUrlDemoStoriesForUser(browserSessionId, userDoc, Models) {
  if (!browserSessionId || !userDoc) return

  const workspaceId = await newestWorkspaceIdForUser(Models, userDoc)
  if (!workspaceId) return

  const urlDemos = await Models.UrlDemo.find({
    browserSessionId,
    status: 'completed',
    type: 'browsed',
    userId: { $exists: false },
    storyId: { $exists: true }
  }).lean()

  if (!urlDemos.length) return

  for (const urlDemo of urlDemos) {
    // One row that cannot be copied must not stop the others
    try {
      const clonedUrlDemo = await cloneUrlDemoWithStoryForUser(
        urlDemo,
        userDoc._id,
        workspaceId,
        urlDemo.browserSessionId,
        Models
      )

      if (clonedUrlDemo) {
        await Models.UrlDemo.updateOne(
          { _id: urlDemo._id },
          {
            $set: {
              storyId: clonedUrlDemo.storyId,
              userId: userDoc._id,
              ...(clonedUrlDemo.agentId && { agentId: clonedUrlDemo.agentId })
            }
          }
        )
      }
    } catch (err) {
      logger.error('[cloneUrlDemoStoriesForUser] clone failed', { eventName: 'CLONE_URL_DEMO_FOR_USER_FAILED', err, data: { urlDemoId: String(urlDemo._id) } })
    }
  }
}
