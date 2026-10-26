// Assert-based self-check for the story version-history core (storyRevisions.js).
// Run against a local Mongo:  node src/helpers/storyRevisions.check.js
// Creates its own throwaway story/screens and cleans them up.

import assert from 'assert'
import mongoose from 'mongoose'
import { setupDB, getModels } from '../models/index.js'
import {

  captureScreenPreImage,
  captureStoryPreImage,
  recordRevision,
  undoOnce,
  redoOnce,
  historyCounts,
} from './storyRevisions.js'
import logger from './logger.js'

const { ObjectId } = mongoose.Types

async function main() {
  const conn = await setupDB()
  const Models = getModels(conn)

  const workspaceId = new ObjectId()
  const story = await Models.Story.create({ name: 'revcheck story', workspaceId, status: 'READY' })
  const storyId = story._id
  const ids = { storyId, workspaceId }

  const cleanup = async () => {
    await Models.Screen.deleteMany({ storyId })
    await Models.Story.deleteMany({ _id: storyId })
    await Models.StoryRevision.deleteMany({ storyId })
  }

  try {
    const screen = await Models.Screen_Video.create({
      storyId, workspaceId, index: 0, name: 'screen A',
      steps: [{ index: 0, view: { viewType: 'tooltip', content: '<p>original</p>' } }],
    })
    await Models.Story.updateOne({ _id: storyId }, { $push: { screens: screen._id } })

    // --- 1. screen-scope: edit -> undo -> redo -------------------------------
    const pre = await captureScreenPreImage(Models, { ...ids, screenId: screen._id })
    assert.ok(pre, 'pre-image captured')
    await recordRevision(Models, { ...pre, actionLabel: 'step:update' })

    await Models.Screen.updateOne(
      { _id: screen._id },
      { $set: { 'steps.0.view.content': '<p>edited</p>' } }
    )

    let counts = await historyCounts(Models, storyId)
    assert.strictEqual(counts.undoCount, 1)
    assert.strictEqual(counts.redoCount, 0)

    const undone = await undoOnce(Models, ids)
    assert.strictEqual(undone.actionLabel, 'step:update')

    let restored = await Models.Screen.findById(screen._id).lean()
    assert.strictEqual(restored.steps[0].view.content, '<p>original</p>', 'undo restored step content')
    assert.strictEqual(restored.type, 'Screen_Video', 'discriminator type survived verbatim restore')

    counts = await historyCounts(Models, storyId)
    assert.strictEqual(counts.undoCount, 0)
    assert.strictEqual(counts.redoCount, 1, 'undo pushed a redo entry')

    const redone = await redoOnce(Models, ids)
    assert.strictEqual(redone.actionLabel, 'step:update')
    restored = await Models.Screen.findById(screen._id).lean()
    assert.strictEqual(restored.steps[0].view.content, '<p>edited</p>', 'redo reapplied the edit')

    counts = await historyCounts(Models, storyId)
    assert.deepStrictEqual(
      { u: counts.undoCount, r: counts.redoCount },
      { u: 1, r: 0 },
      'redo moved the entry back to the undo stack'
    )

    // --- 2. a fresh edit wipes the redo stack --------------------------------
    await undoOnce(Models, ids) // back to original, redoCount = 1
    const pre2 = await captureScreenPreImage(Models, { ...ids, screenId: screen._id })
    await recordRevision(Models, { ...pre2, actionLabel: 'screen:update' })
    counts = await historyCounts(Models, storyId)
    assert.strictEqual(counts.redoCount, 0, 'new edit wiped the redo stack')

    // --- 3. story-scope: screen delete -> undo resurrects same _id -----------
    const preDelete = await captureStoryPreImage(Models, { ...ids, fullScreens: true })
    await recordRevision(Models, { ...preDelete, actionLabel: 'screen:delete' })

    // simulate deleteScreen.js: hard delete + $pull
    await Models.Screen.deleteOne({ _id: screen._id })
    await Models.Story.updateOne({ _id: storyId }, { $pull: { screens: screen._id } })
    assert.strictEqual(await Models.Screen.exists({ _id: screen._id }), null, 'screen is gone')

    await undoOnce(Models, ids)

    const resurrected = await Models.Screen.findById(screen._id).lean()
    assert.ok(resurrected, 'undo resurrected the deleted screen')
    assert.strictEqual(String(resurrected._id), String(screen._id), 'same _id preserved')
    assert.strictEqual(resurrected.index, 0, 'index restored')
    assert.strictEqual(resurrected.steps[0].view.content, '<p>original</p>', 'embedded steps intact')

    const storyAfter = await Models.Story.findById(storyId).lean()
    assert.ok(
      storyAfter.screens.map(String).includes(String(screen._id)),
      'Story.screens reference restored'
    )

    // --- 4. redo of the delete removes the screen again ----------------------
    await redoOnce(Models, ids)
    assert.strictEqual(await Models.Screen.exists({ _id: screen._id }), null, 'redo re-deleted the screen')

    logger.info('storyRevisions.check: ALL OK', { eventName: 'STORYREVISIONS_CHECK_ALL_OK' })
  } finally {
    await cleanup()
    await conn.close()
  }
}

main().catch((err) => {
  logger.error(err, { eventName: 'STORY_REVISIONS_FAILED' })
  process.exit(1)
})
