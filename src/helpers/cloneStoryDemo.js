import mongoose from 'mongoose'
import fsp from 'fs/promises'
import ENV from '../envServer.js'
import ScreenTypes from '../constants/ScreenTypes.js'
import { remapSandbox } from './sandbox/sandbox.js'
import { copyChecklist } from './checklist/checklist.js'

const { ObjectId } = mongoose.Types

function getScreenModel(Models, type) {
  if (type === ScreenTypes.SCREEN_PAGE) return Models.Screen_Page
  if (type === ScreenTypes.SCREEN_VIDEO) return Models.Screen_Video
  if (type === ScreenTypes.SCREEN_SCREENSHOT) return Models.Screen_Screenshot
  return Models.Screen
}

async function copyFileSafe(srcPath, destPath) {
  if (!srcPath) return
  try {
    await fsp.copyFile(srcPath, destPath)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}

function cloneSteps(steps, remapGotoScreen) {
  return (steps || []).map((step) => {
    const { _id, createdAt, updatedAt, stepAudioId, ...stepData } = step
    if (stepData.zoomSpan?._id) {
      delete stepData.zoomSpan._id
      delete stepData.zoomSpan.createdAt
      delete stepData.zoomSpan.updatedAt
    }
    if (stepData.view?.popup?.buttons) {
      stepData.view.popup.buttons = stepData.view.popup.buttons.map((btn) => {
        const { _id: btnId, ...btnData } = btn
        return {
          ...btnData,
          gotoScreen: remapGotoScreen(btnData.gotoScreen),
        }
      })
    }
    if (stepData.view?.popup) {
      stepData.view.popup = { ...stepData.view.popup }
      delete stepData.view.popup.formId
    }
    return stepData
  })
}

function cloneTransitions(transitions, remapGotoScreen) {
  return (transitions || []).map((transition) => {
    const { _id, createdAt, updatedAt, ...transitionData } = transition
    const cloned = {
      ...transitionData,
      gotoScreen: remapGotoScreen(transitionData.gotoScreen),
    }
    if (cloned.popup?.formId) {
      cloned.popup = { ...cloned.popup }
      delete cloned.popup.formId
    }
    return cloned
  })
}

async function cloneScreenFiles(screen, oldStoryId, newStoryId, newScreenId) {
  const newStoryDir = `${ENV.STORIES_FOLDER}/${newStoryId}`
  await fsp.mkdir(newStoryDir, { recursive: true })

  const fileUpdates = {}

  if (screen.contentPath) {
    const dest = `${newStoryDir}/${newScreenId}.html`
    await copyFileSafe(screen.contentPath, dest)
    fileUpdates.contentPath = dest
  }
  if (screen.snapshotPath) {
    const dest = `${newStoryDir}/${newScreenId}.rrweb.json`
    await copyFileSafe(screen.snapshotPath, dest)
    fileUpdates.snapshotPath = dest
  }
  if (screen.eventsPath) {
    const dest = `${newStoryDir}/${newScreenId}.events.json`
    await copyFileSafe(screen.eventsPath, dest)
    fileUpdates.eventsPath = dest
  }

  return fileUpdates
}

async function cloneForm(oldFormId, refs, Models) {
  const form = await Models.Form.findById(oldFormId).lean()
  if (!form) return null

  const { _id, createdAt, updatedAt, leads, ...formData } = form
  return new Models.Form({
    ...formData,
    storyId: refs.storyId,
    screenId: refs.screenId,
    stepId: refs.stepId,
    transitionId: refs.transitionId,
    workspaceId: refs.workspaceId,
  }).save()
}

async function cloneStepAudio(oldAudioId, refs, Models) {
  const audio = await Models.StepAudio.findById(oldAudioId).lean()
  if (!audio) return null

  const { _id, createdAt, updatedAt, ...audioData } = audio
  return new Models.StepAudio({
    ...audioData,
    storyId: refs.storyId,
    screenId: refs.screenId,
    stepId: refs.stepId,
  }).save()
}

async function remapScreenEmbeddedRefs(savedScreen, oldScreen, refs, Models) {
  let dirty = false

  for (let i = 0; i < (oldScreen.steps || []).length; i++) {
    const oldStep = oldScreen.steps[i]
    const savedStep = savedScreen.steps[i]
    if (!oldStep || !savedStep) continue

    if (oldStep.view?.popup?.formId) {
      const newForm = await cloneForm(oldStep.view.popup.formId, {
        ...refs,
        screenId: savedScreen._id,
        stepId: savedStep._id,
        transitionId: null,
      }, Models)
      if (newForm && savedStep.view?.popup) {
        savedStep.view.popup.formId = newForm._id
        dirty = true
      }
    }

    if (oldStep.stepAudioId) {
      const newAudio = await cloneStepAudio(oldStep.stepAudioId, {
        storyId: refs.storyId,
        screenId: savedScreen._id,
        stepId: savedStep._id,
      }, Models)
      if (newAudio) {
        savedStep.stepAudioId = newAudio._id
        dirty = true
      }
    }
  }

  for (let i = 0; i < (oldScreen.customTransitions || []).length; i++) {
    const oldTransition = oldScreen.customTransitions[i]
    const savedTransition = savedScreen.customTransitions[i]
    if (!oldTransition?.popup?.formId || !savedTransition) continue

    const newForm = await cloneForm(oldTransition.popup.formId, {
      ...refs,
      screenId: savedScreen._id,
      stepId: null,
      transitionId: savedTransition._id,
    }, Models)
    if (newForm) {
      savedTransition.popup.formId = newForm._id
      dirty = true
    }
  }

  if (oldScreen.popups?.formId) {
    const newForm = await cloneForm(oldScreen.popups.formId, {
      ...refs,
      screenId: savedScreen._id,
      stepId: null,
      transitionId: null,
    }, Models)
    if (newForm) {
      savedScreen.popups = savedScreen.popups || {}
      savedScreen.popups.formId = newForm._id
      dirty = true
    }
  }

  if (dirty) {
    savedScreen.markModified('steps')
    savedScreen.markModified('customTransitions')
    if (savedScreen.popups) savedScreen.markModified('popups')
    await savedScreen.save()
  }
}

/**
 * Deep-clone a StoryDemo (all screens, steps, files, forms, audio, cursors).
 * @param {string|ObjectId} storyId
 * @param {string|ObjectId} userId
 * @param {string|ObjectId} workspaceId
 * @param {object} Models
 * @param {{ nameSuffix?: string }} options
 * @returns {Promise<ObjectId|null>} new story id
 */
export async function cloneStoryDemo(storyId, userId, workspaceId, Models, options = {}) {
  const { nameSuffix = ' (2)' } = options

  const storyDoc = await Models.Story.findOne({ _id: storyId, deletedAt: null }).populate('screens').lean()
  if (!storyDoc) return null

  const newStoryId = new ObjectId()
  const oldStoryId = storyDoc._id
  const oldScreens = [...(storyDoc.screens || [])].sort((a, b) => a.index - b.index)

  const newScreenIds = oldScreens.map(() => new ObjectId())
  const firstNewScreenId = newScreenIds[0] || null

  const oldScreenIdToScreenIndex = new Map(
    oldScreens.map((screen) => [screen._id.toString(), screen.index])
  )
  const newScreenIdByScreenIndex = new Map(
    oldScreens.map((screen, i) => [screen.index, newScreenIds[i]])
  )
  const oldScreenIdToNew = new Map(
    oldScreens.map((screen, i) => [screen._id.toString(), newScreenIds[i]])
  )

  const remapGotoScreen = (gotoScreenId) => {
    if (!gotoScreenId) return gotoScreenId
    const direct = oldScreenIdToNew.get(gotoScreenId.toString())
    if (direct) return direct
    const screenIndex = oldScreenIdToScreenIndex.get(gotoScreenId.toString())
    return newScreenIdByScreenIndex.get(screenIndex) || firstNewScreenId
  }

  const sandboxRemap = storyDoc.mode === 'sandbox' && storyDoc.sandbox ? remapSandbox(storyDoc.sandbox, oldScreenIdToNew) : null

  const oldStoryCursors = await Models.CursorPositions.find({ storyId: oldStoryId }).lean()
  const cursorIdMap = new Map()
  for (const cursor of oldStoryCursors) {
    const newCursor = await new Models.CursorPositions({
      storyId: newStoryId,
      frameX: cursor.frameX,
      frameY: cursor.frameY,
      timeMs: cursor.timeMs,
    }).save()
    cursorIdMap.set(cursor._id.toString(), newCursor._id)
  }

  const savedScreens = []
  for (let index = 0; index < oldScreens.length; index++) {
    const screen = oldScreens[index]
    const newScreenId = newScreenIds[index]
    const fileUpdates = await cloneScreenFiles(screen, oldStoryId, newStoryId, newScreenId)

    const { _id, createdAt, updatedAt, ...screenData } = screen
    const ScreenModel = getScreenModel(Models, screen.type)

    const screenPayload = {
      ...screenData,
      _id: newScreenId,
      storyId: newStoryId,
      workspaceId,
      userId,
      steps: cloneSteps(screen.steps, remapGotoScreen),
      customTransitions: cloneTransitions(screen.customTransitions, remapGotoScreen),
      ...fileUpdates,
    }

    if (screen.baseScreenId) {
      screenPayload.baseScreenId = oldScreenIdToNew.get(screen.baseScreenId.toString()) || screen.baseScreenId
    }

    if (screen.cursorPositions?.length) {
      screenPayload.cursorPositions = screen.cursorPositions
        .map((id) => cursorIdMap.get(id.toString()))
        .filter(Boolean)
    }

    if (screen.popups?.formId) {
      screenPayload.popups = { ...screen.popups }
      delete screenPayload.popups.formId
    }

    if (sandboxRemap) {
      Object.assign(screenPayload, sandboxRemap.screenFields(screen))
    }

    const savedScreen = await new ScreenModel(screenPayload).save()
    await remapScreenEmbeddedRefs(savedScreen, screen, { storyId: newStoryId, workspaceId }, Models)
    savedScreens.push(savedScreen)
  }

  const {
    _id,
    createdAt,
    updatedAt,
    deletedAt,
    links,
    isPublished,
    screens: _oldScreens,
    content: oldContentField,
    ...storyData
  } = storyDoc

  let contentField = oldContentField
  if (oldContentField?.contentId) {
    const oldContent = await Models.StoryContent.findById(oldContentField.contentId).lean()
    if (oldContent) {
      const { _id: oldContentId, createdAt: cAt, updatedAt: uAt, ...contentData } = oldContent
      const newContent = await new Models.StoryContent({
        ...contentData,
        storyId: newStoryId,
        workspaceId,
      }).save()
      contentField = { ...oldContentField, contentId: newContent._id }
    }
  }

  if (storyData.custom && storyData.custom.checklist) {
    storyData.custom = {
      ...storyData.custom,
      checklist: await copyChecklist(Models, storyData.custom.checklist, {
        oldStoryId,
        newStoryId,
        workspaceId,
        stepIds: new Map(oldScreens.flatMap((screen, i) => (screen.steps || []).map((step, j) => [String(step._id), savedScreens[i].steps[j] && savedScreens[i].steps[j]._id])))
      })
    }
  }

  await new Models.Story({
    ...storyData,
    _id: newStoryId,
    name: `${storyDoc.name || 'Untitled'}${nameSuffix}`,
    userId,
    workspaceId,
    screens: savedScreens.map((s) => s._id),
    content: contentField,
    links: [],
    isPublished: false,
    deletedAt: null,
    ...(sandboxRemap ? { sandbox: sandboxRemap.sandbox } : {}),
  }).save()

  return newStoryId
}
