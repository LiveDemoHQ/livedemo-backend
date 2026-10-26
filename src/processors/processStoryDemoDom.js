import fsp from 'fs/promises'
import ENV from '../envServer.js'
import StoryStatuses from '../constants/StoryStatuses.js'
import mongoose from 'mongoose'
const { ObjectId } = mongoose.Types
import flixHelpers from '../helpers/flixHelpers.js'
import { segmentRrwebEvents } from '../helpers/domDeltaSegmenter.js'
import { stringifyRrwebEvents } from '../helpers/rrwebEventNames.js'
import short from 'short-uuid'
import he from 'he'

import logger from '../helpers/logger.js'

const SCREENDOC_ENCODING = 'utf-8'

function pickClickMeta(clickThumbnails, targetTs) {
  if (!Array.isArray(clickThumbnails) || !clickThumbnails.length || targetTs == null) {
    return null
  }
  let best = null
  let bestDist = Infinity
  for (let i = 0; i < clickThumbnails.length; i++) {
    const thumb = clickThumbnails[i]
    if (!thumb || thumb.timestamp == null) {
      continue
    }
    const dist = Math.abs(thumb.timestamp - targetTs)
    if (dist < bestDist) {
      bestDist = dist
      best = thumb
    }
  }
  return best
}

function pickThumbnail(clickThumbnails, targetTs) {
  const meta = pickClickMeta(clickThumbnails, targetTs)
  return (meta && meta.imageData) || ''
}

/**
 * Mirror processStoryDemo hotspot steps from Flix click capture.
 */
function buildHotspotSteps({ frameX, frameY, targetText, targetHTML, targetElementType }) {
  if (frameX == null || frameY == null || (frameX === 0 && frameY === 0)) {
    return [{
      view: {
        content: '<p>Welcome to our StoryDemo!</p>'
      }
    }]
  }

  const contentText = targetText
    ? `<p>Click on ${targetText}</p>`
    : '<p>Click here</p>'

  return [{
    index: 0,
    view: {
      hotspot: {
        frameX,
        frameY,
      },
      viewType: 'hotspot',
      content: contentText,
    },
    elementData: {
      targetHTML: targetHTML ? he.encode(targetHTML) : '',
      targetElementType: targetElementType || '',
      targetText: targetText || '',
    },
  }]
}

function stepsForDelta(delta, clickThumbnails) {
  const matchTs = delta.clickTimestamp != null ? delta.clickTimestamp : delta.fromTimeMs
  const meta = pickClickMeta(clickThumbnails, matchTs)

  const metaHasCoords = meta
    && typeof meta.frameX === 'number'
    && typeof meta.frameY === 'number'
    && !(meta.frameX === 0 && meta.frameY === 0)

  const deltaHasCoords = typeof delta.clickX === 'number'
    && typeof delta.clickY === 'number'
    && !(delta.clickX === 0 && delta.clickY === 0)

  const frameX = metaHasCoords ? meta.frameX : (deltaHasCoords ? delta.clickX : null)
  const frameY = metaHasCoords ? meta.frameY : (deltaHasCoords ? delta.clickY : null)

  return buildHotspotSteps({
    frameX,
    frameY,
    targetText: (delta && delta.targetText) || (meta && meta.targetText) || '',
    targetHTML: (delta && delta.targetHTML) || (meta && meta.targetHTML) || '',
    targetElementType: (delta && delta.targetElementType) || (meta && meta.targetElementType) || '',
  })
}

function deltaScreenName(delta, deltaCounter) {
  const text = delta && delta.targetText ? String(delta.targetText).replace(/^"|"$/g, '').trim() : ''
  if (text) {
    return text.length > 40 ? `${text.slice(0, 40)}…` : text
  }
  return `Delta ${deltaCounter}`
}

/**
 * Flix-style empty end-state screen: no CTA / no overlay step.
 */
function buildEmptyFinalSteps() {
  return []
}

async function ensureStoryDir(storyId) {
  const storyDir = `${ENV.STORIES_FOLDER}/${storyId}`
  try {
    await fsp.access(storyDir)
  } catch {
    await fsp.mkdir(storyDir, { recursive: true })
  }
  return storyDir
}

async function uploadThumb(imageData) {
  if (!imageData) {
    return ''
  }
  try {
    const imageName = short.uuid() + '.png'
    const uploadResult = await flixHelpers.uploadImage(imageData, imageName)
    return uploadResult.Location || ''
  } catch (err) {
    logger.error('processStoryDemoDom thumbnail upload failed', { eventName: 'PROCESSSTORYDEMODOM_THUMBNAIL_UPLOAD_FAILED', err: err })
    return ''
  }
}

async function createRrwebScreenDoc({
  Models,
  storyDoc,
  authUserId,
  name,
  recordingRole,
  baseScreenId,
  events,
  fromTimeMs,
  toTimeMs,
  width,
  height,
  imageData,
  index,
  steps,
}) {
  const screenId = new ObjectId()
  const storyDir = await ensureStoryDir(String(storyDoc._id))
  const fileName = recordingRole === 'base'
    ? `${screenId}.rrweb.json`
    : `${screenId}.events.json`
  const filePath = `${storyDir}/${fileName}`

  await fsp.writeFile(filePath, stringifyRrwebEvents(events), { encoding: SCREENDOC_ENCODING })

  const imageUrl = await uploadThumb(imageData)

  const screenObj = {
    _id: screenId,
    name,
    workspaceId: storyDoc.workspaceId,
    userId: authUserId || storyDoc.userId,
    storyId: storyDoc._id,
    width,
    height,
    imageUrl,
    index,
    recordingRole,
    eventCount: events.length,
    fromTimeMs,
    toTimeMs,
    steps: steps || [{
      view: {
        content: '<p>Welcome to our StoryDemo!</p>'
      }
    }],
  }

  if (recordingRole === 'base') {
    screenObj.snapshotPath = filePath
  } else {
    screenObj.eventsPath = filePath
    screenObj.baseScreenId = baseScreenId
  }

  return new Models.Screen_Page(screenObj)
}

async function processStoryDemoDom(sharedConfig, params, callback) {
  const { Models } = sharedConfig
  const { storyDemoId } = params

  logger.info(`Started - processStoryDemoDom - ${storyDemoId}`, { eventName: 'PROCESS_STORY_DEMO_DOM' })

  return Models.Story.findOne({ _id: storyDemoId })
    .lean()
    .then(async (storyDemoDoc) => {
      if (!storyDemoDoc) {
        throw new Error(`Story not found - ${storyDemoId}`)
      }
      if (!storyDemoDoc.filePath) {
        throw new Error(`Cannot process storyDemoDom - missing filePath`)
      }

      const raw = await fsp.readFile(storyDemoDoc.filePath, { encoding: 'utf8' })
      let payload
      try {
        payload = JSON.parse(raw)
      } catch (e) {
        throw new Error(`Invalid dom recording JSON at ${storyDemoDoc.filePath}`)
      }

      const events = Array.isArray(payload.events) ? payload.events : []
      if (!events.length) {
        throw new Error('Dom recording has no events')
      }

      const clickThumbnails = Array.isArray(payload.clickThumbnails) ? payload.clickThumbnails : []
      const width = (payload.viewport && payload.viewport.width)
        || (storyDemoDoc.windowMeasures && storyDemoDoc.windowMeasures.innerWidth)
        || (storyDemoDoc.rrweb && storyDemoDoc.rrweb.viewport && storyDemoDoc.rrweb.viewport.width)
        || 0
      const height = (payload.viewport && payload.viewport.height)
        || (storyDemoDoc.windowMeasures && storyDemoDoc.windowMeasures.innerHeight)
        || (storyDemoDoc.rrweb && storyDemoDoc.rrweb.viewport && storyDemoDoc.rrweb.viewport.height)
        || 0

      const chains = segmentRrwebEvents(events, clickThumbnails)
      if (!chains.length) {
        throw new Error('Dom recording produced no rrweb chains')
      }

      // Replace any screens created mid-recording (should be empty for the new path)
      const existingScreenIds = Array.isArray(storyDemoDoc.screens) ? storyDemoDoc.screens : []
      if (existingScreenIds.length) {
        await Models.Screen.deleteMany({ _id: { $in: existingScreenIds } })
      }

      const screenDocs = []
      let index = 0
      let deltaCounter = 0
      // Snapshot of the latest visual end-state used to append Flix-style empty final screen.
      let lastEndState = null
      // True when the last delta already is the empty end-state screen (no further click).
      let lastDeltaIsFinal = false

      for (let c = 0; c < chains.length; c++) {
        const chain = chains[c]
        const baseEvents = chain.baseEvents
        if (!baseEvents || !baseEvents.length) {
          continue
        }

        const deltas = Array.isArray(chain.deltas) ? chain.deltas : []
        // Hotspot for click N belongs on the screen that shows the state *before*
        // that click (Flix-style). So: base ← click0, delta0 ← click1, ...
        const firstClick = deltas[0] || null

        const baseThumbTs = firstClick && firstClick.clickTimestamp != null
          ? firstClick.clickTimestamp
          : baseEvents[baseEvents.length - 1].timestamp

        const baseThumb = pickThumbnail(clickThumbnails, baseThumbTs)
        const baseName = firstClick
          ? (deltaScreenName(firstClick, 0) || (chains.length > 1 ? `Base ${c + 1}` : 'Base'))
          : (chains.length > 1 ? `Base ${c + 1}` : 'Base')

        const baseDoc = await createRrwebScreenDoc({
          Models,
          storyDoc: storyDemoDoc,
          authUserId: storyDemoDoc.userId,
          name: baseName,
          recordingRole: 'base',
          events: baseEvents,
          fromTimeMs: baseEvents[0].timestamp,
          toTimeMs: baseEvents[baseEvents.length - 1].timestamp,
          width,
          height,
          imageData: baseThumb,
          index,
          steps: firstClick
            ? stepsForDelta(firstClick, clickThumbnails)
            : [{ view: { content: '<p>Welcome to our StoryDemo!</p>' } }],
        })
        screenDocs.push(baseDoc)
        const baseScreenId = baseDoc._id
        index += 1

        lastEndState = {
          baseScreenId,
          events: [],
          fromTimeMs: baseEvents[0].timestamp,
          toTimeMs: baseEvents[baseEvents.length - 1].timestamp,
          imageData: baseThumb,
        }
        lastDeltaIsFinal = false

        for (let d = 0; d < deltas.length; d++) {
          const delta = deltas[d]
          deltaCounter += 1
          // CTA on this screen is the *next* click (the one performed from this state).
          const nextClick = d + 1 < deltas.length ? deltas[d + 1] : null
          const isFinalDelta = !nextClick
          const deltaMatchTs = nextClick && nextClick.clickTimestamp != null
            ? nextClick.clickTimestamp
            : (delta.toTimeMs != null ? delta.toTimeMs : delta.clickTimestamp)
          const deltaThumb = pickThumbnail(clickThumbnails, deltaMatchTs)
          const deltaDoc = await createRrwebScreenDoc({
            Models,
            storyDoc: storyDemoDoc,
            authUserId: storyDemoDoc.userId,
            name: nextClick
              ? deltaScreenName(nextClick, deltaCounter)
              : 'Final',
            recordingRole: 'delta',
            baseScreenId,
            events: delta.events,
            fromTimeMs: delta.fromTimeMs,
            toTimeMs: delta.toTimeMs,
            width,
            height,
            imageData: deltaThumb,
            index,
            steps: nextClick
              ? stepsForDelta(nextClick, clickThumbnails)
              : buildEmptyFinalSteps(),
          })
          screenDocs.push(deltaDoc)
          index += 1

          lastEndState = {
            baseScreenId,
            events: delta.events,
            fromTimeMs: delta.fromTimeMs,
            toTimeMs: delta.toTimeMs,
            imageData: deltaThumb,
          }
          lastDeltaIsFinal = isFinalDelta
        }
      }

      if (!screenDocs.length) {
        throw new Error('Dom recording segmentation created no screens')
      }

      // Append Flix-style empty final only when the last click screen still has a CTA
      // (no deltas) — otherwise the last delta already is the empty end screen.
      if (lastEndState && !lastDeltaIsFinal) {
        const finalThumb = pickThumbnail(clickThumbnails, lastEndState.toTimeMs)
          || lastEndState.imageData
        const finalDoc = await createRrwebScreenDoc({
          Models,
          storyDoc: storyDemoDoc,
          authUserId: storyDemoDoc.userId,
          name: 'Final',
          recordingRole: 'delta',
          baseScreenId: lastEndState.baseScreenId,
          events: lastEndState.events,
          fromTimeMs: lastEndState.fromTimeMs,
          toTimeMs: lastEndState.toTimeMs,
          width,
          height,
          imageData: finalThumb,
          index,
          steps: buildEmptyFinalSteps(),
        })
        screenDocs.push(finalDoc)
      }

      const savedScreens = await Models.Screen_Page.insertMany(screenDocs)
      const screenIds = savedScreens.map((s) => s._id)

      await Models.Story.findOneAndUpdate(
        { _id: storyDemoId },
        {
          $set: {
            screens: screenIds,
            status: StoryStatuses.READY,
            thumbnailImageUrl: savedScreens[0] && savedScreens[0].imageUrl
              ? savedScreens[0].imageUrl
              : (storyDemoDoc.thumbnailImageUrl || ''),
          }
        }
      )

      await Models.Workspace.findOneAndUpdate(
        { _id: storyDemoDoc.workspaceId },
        {
          $addToSet: {
            'library.pages': { $each: screenIds },
          }
        }
      )

      logger.info(`Finished - processStoryDemoDom - ${storyDemoId} screens=${screenIds.length}`, { eventName: 'PROCESS_STORY_DEMO_DOM' })
      callback(null, { storyDemoId, screenCount: screenIds.length })
    })
    .catch((err) => {
      logger.error(`Failed - processStoryDemoDom - ${storyDemoId}`, { eventName: 'PROCESS_STORY_DEMO_DOM_FAILED', err: err })
      return Models.Story.findOneAndUpdate(
        { _id: storyDemoId },
        { $set: { status: StoryStatuses.FAILED } }
      )
        .catch(() => null)
        .then(() => {
          callback(err)
        })
    })
}

// Shared with processSandboxDom
export { pickClickMeta, pickThumbnail, deltaScreenName, createRrwebScreenDoc }

const config = {
  queueNames: ['storyDemos'],
  jobNames: ['processStoryDemoDom'],
  handler: processStoryDemoDom,
}

export default config
