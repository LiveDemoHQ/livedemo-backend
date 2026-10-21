import ENV from '../envServer.js'

// ponytail: per-story cap + count-then-prune on every edit (2 extra cheap queries).
// Upgrade path if it ever matters: TTL index on createdAt or a scheduled prune job.
const MAX_REVISIONS_PER_STORY = Number(ENV.STORY_REVISIONS_MAX) || 1000

export async function captureScreenPreImage(Models, { storyId, workspaceId, screenId }) {
  const screen = await Models.Screen.findOne({ _id: screenId, storyId }).lean()
  if (!screen) return null

  return { storyId, workspaceId, scope: 'screen', screenId, screenPreImage: screen }
}

export async function captureStoryPreImage(Models, { storyId, workspaceId, fullScreens = false }) {
  const story = await Models.Story.findById(storyId).lean()
  if (!story) return null

  const screens = await Models.Screen.find({ storyId })
    .select(fullScreens ? undefined : '_id index')
    .lean()

  return {
    storyId,
    workspaceId,
    scope: 'story',
    storyPreImage: {
      name: story.name,
      status: story.status,
      custom: story.custom,
      screens: story.screens,
      ...(story.sandbox ? { sandbox: story.sandbox } : {}),
    },
    screenIndexes: screens.map(s => ({ _id: s._id, index: s.index })),
    fullScreens: fullScreens ? screens : null,
  }
}

// Called by the capture middleware after a successful edit.
export async function recordRevision(Models, payload) {
  await Models.StoryRevision.create({ ...payload, kind: 'undo' })

  // A new edit invalidates the redo branch (linear history, like every editor)
  await Models.StoryRevision.deleteMany({ storyId: payload.storyId, kind: 'redo' })

  const excess = await Models.StoryRevision.countDocuments({ storyId: payload.storyId, kind: 'undo' })
    - MAX_REVISIONS_PER_STORY
  if (excess > 0) {
    const oldest = await Models.StoryRevision.find({ storyId: payload.storyId, kind: 'undo' })
      .sort({ _id: 1 }).limit(excess).select('_id').lean()
    await Models.StoryRevision.deleteMany({ _id: { $in: oldest.map(d => d._id) } })
  }
}

// Writes a pre-image back. Pre-images were read from these same collections by the
// server and never touched by a client, so verbatim raw-collection writes are safe.
// Raw writes also sidestep Mongoose discriminator/strict stripping (zoomSpans lives
// on the Screen_Video discriminator and a base-model write would drop it).
async function applyRevision(Models, rev) {
  if (rev.scope === 'screen') {
    const exists = await Models.Screen.exists({ _id: rev.screenId })
    if (exists) {
      await Models.Screen.collection.replaceOne({ _id: rev.screenId }, rev.screenPreImage)
    } else {
      // Screen was deleted later; strict LIFO means that delete was already undone
      // before this entry is reached — this branch is a belt-and-braces resurrect
      await Models.Screen.collection.insertOne(rev.screenPreImage)
      await Models.Story.updateOne({ _id: rev.storyId }, { $addToSet: { screens: rev.screenId } })
    }

    // deleteStepAudio soft-deletes the Audio doc; re-attaching stepAudioId must revive it
    const audioIds = (rev.screenPreImage.steps || []).map(s => s.stepAudioId).filter(Boolean)
    if (audioIds.length) {
      await Models.Audio.updateMany({ _id: { $in: audioIds } }, { $set: { deletedAt: null } })
    }

    return
  }

  // scope === 'story'
  const { storyPreImage, screenIndexes, fullScreens } = rev

  await Models.Story.updateOne({ _id: rev.storyId }, {
    $set: {
      name: storyPreImage.name,
      status: storyPreImage.status,
      custom: storyPreImage.custom,
      screens: storyPreImage.screens,
      ...(storyPreImage.sandbox ? { sandbox: storyPreImage.sandbox } : {}),
    }
  })

  const preIds = new Set((screenIndexes || []).map(s => String(s._id)))
  const current = await Models.Screen.find({ storyId: rev.storyId }).select('_id').lean()
  const currentIds = new Set(current.map(s => String(s._id)))

  // Undo of screen add/copy/upload: remove screens that didn't exist at capture time.
  // (popAndApply snapshots them with fullScreens before this runs, so the opposite
  // direction can resurrect them.)
  const toDelete = current.filter(s => !preIds.has(String(s._id)))
  if (toDelete.length) {
    await Models.Screen.deleteMany({ _id: { $in: toDelete.map(s => s._id) } })
  }

  // Undo of screen delete: resurrect docs that existed at capture time (same _ids,
  // so every gotoScreen / baseScreenId reference pointing at them works again)
  if (fullScreens && fullScreens.length) {
    const toInsert = fullScreens.filter(s => !currentIds.has(String(s._id)))
    if (toInsert.length) {
      await Models.Screen.collection.insertMany(toInsert)
    }
    // Sandbox bulk edits (merge, delete, sync) rewrite links on many screens
    if (storyPreImage.sandbox) {
      const toReplace = fullScreens.filter(s => currentIds.has(String(s._id)))
      if (toReplace.length) {
        await Models.Screen.collection.bulkWrite(toReplace.map(s => ({ replaceOne: { filter: { _id: s._id }, replacement: s } })))
      }
    }
  }

  // Restore ordering (deleteScreen reindexes everything; updateScreenOrder rewrites it)
  if (screenIndexes && screenIndexes.length) {
    await Models.Screen.bulkWrite(screenIndexes.map(({ _id, index }) => ({
      updateOne: { filter: { _id }, update: { $set: { index } } }
    })))
  }
}

async function popAndApply(Models, { storyId, workspaceId }, fromKind, toKind) {
  const rev = await Models.StoryRevision.findOne({ storyId, kind: fromKind }).sort({ _id: -1 }).lean()
  if (!rev) return null

  // Snapshot the CURRENT state of the same scope first — it becomes the entry
  // on the opposite stack. Always fullScreens for story scope: applying may
  // delete screens, and the opposite direction must be able to resurrect them.
  const counterPayload = rev.scope === 'screen'
    ? await captureScreenPreImage(Models, { storyId, workspaceId, screenId: rev.screenId })
    : await captureStoryPreImage(Models, { storyId, workspaceId, fullScreens: true })

  if (counterPayload) {
    await Models.StoryRevision.create({ ...counterPayload, kind: toKind, actionLabel: rev.actionLabel })
  }

  // Order matters for crash-safety: apply, THEN consume. If apply dies midway
  // the entry is still on the stack and the next press retries it.
  await applyRevision(Models, rev)
  await Models.StoryRevision.deleteOne({ _id: rev._id })

  return rev
}

export const undoOnce = (Models, ids) => popAndApply(Models, ids, 'undo', 'redo')
export const redoOnce = (Models, ids) => popAndApply(Models, ids, 'redo', 'undo')

export async function historyCounts(Models, storyId) {
  const [undoCount, redoCount] = await Promise.all([
    Models.StoryRevision.countDocuments({ storyId, kind: 'undo' }),
    Models.StoryRevision.countDocuments({ storyId, kind: 'redo' }),
  ])

  return { undoCount, redoCount, canUndo: undoCount > 0, canRedo: redoCount > 0 }
}
