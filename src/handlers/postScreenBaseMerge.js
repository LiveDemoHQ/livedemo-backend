import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import ENV from '../envServer.js'
import mongoose from 'mongoose'
import fsp from 'fs/promises'
import {
  decodeRrwebEvents,
  stringifyRrwebEvents,
} from '../helpers/rrwebEventNames.js'
import ScreenTypes from '../constants/ScreenTypes.js'

import logger from '../helpers/logger.js'

const { ObjectId } = mongoose.Types
const SCREENDOC_ENCODING = 'utf-8'

const CORS_HEADERS = {
  'Access-Control-Max-Age': 600,
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
  'Access-Control-Allow-Credentials': true,
}

function httpError(statusCode, message) {
  const error = new Error(message)
  error.resultResponse = {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ message }),
  }
  throw error
}

async function readRrwebEvents(filePath) {
  if (!filePath) {
    return []
  }
  const raw = await fsp.readFile(filePath, { encoding: SCREENDOC_ENCODING })
  try {
    return decodeRrwebEvents(JSON.parse(raw))
  } catch (e) {
    logger.error('Failed to parse rrweb events at', { eventName: 'FAILED_TO_PARSE_RRWEB_EVENTS_AT_FAILED', err: e })
    return []
  }
}

function cloneSteps(steps) {
  return (steps || []).map((step) => {
    const { _id, createdAt, updatedAt, ...stepData } = step
    if (stepData.zoomSpan && stepData.zoomSpan._id) {
      delete stepData.zoomSpan._id
      delete stepData.zoomSpan.createdAt
      delete stepData.zoomSpan.updatedAt
    }
    if (stepData.view && stepData.view.popup && stepData.view.popup.buttons) {
      stepData.view.popup.buttons = stepData.view.popup.buttons.map((btn) => {
        const { _id: btnId, ...btnData } = btn
        return btnData
      })
    }
    return stepData
  })
}

/**
 * Build a standalone rrweb base Screen_Page from:
 * - a base screen (clone), or
 * - a delta + its base (base snapshot + cumulative delta events)
 * Insert into the target story after afterScreenId (or after source / append).
 */
const handler = function (req, res) {
  let { Models } = req.mongo

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let screenId = req.params.screenId
  let authUserDoc = null

  return Promise.resolve()
    .then(async () => {
      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser
      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(async () => {
      const storyDoc = await Models.Story.findOne({ _id: storyId, workspaceId })
      if (!storyDoc) {
        httpError(ResponseCodes['404_NOT_FOUND'], 'Story not found')
      }

      const source = await Models.Screen.findOne({ _id: screenId }).lean()
      if (!source || source.type !== ScreenTypes.SCREEN_PAGE || !source.recordingRole) {
        httpError(
          ResponseCodes['400_BAD_REQUEST'],
          'baseMerge requires an rrweb Screen_Page (base or delta)'
        )
      }

      let mergedEvents = []
      let fromTimeMs = source.fromTimeMs
      let toTimeMs = source.toTimeMs
      let name = source.name || 'Base'
      let imageUrl = source.imageUrl || ''
      let width = source.width
      let height = source.height
      let steps = cloneSteps(source.steps)

      if (source.recordingRole === 'base') {
        mergedEvents = await readRrwebEvents(source.snapshotPath)
        if (!mergedEvents.length) {
          httpError(ResponseCodes['400_BAD_REQUEST'], 'Base screen has no events')
        }
      } else if (source.recordingRole === 'delta') {
        if (!source.baseScreenId) {
          httpError(ResponseCodes['400_BAD_REQUEST'], 'Delta is missing baseScreenId')
        }
        const base = await Models.Screen.findOne({ _id: source.baseScreenId }).lean()
        if (!base || base.recordingRole !== 'base') {
          httpError(ResponseCodes['400_BAD_REQUEST'], 'Delta baseScreenId must resolve to a base screen')
        }
        const baseEvents = await readRrwebEvents(base.snapshotPath)
        const deltaEvents = await readRrwebEvents(source.eventsPath)
        if (!baseEvents.length) {
          httpError(ResponseCodes['400_BAD_REQUEST'], 'Linked base screen has no events')
        }
        // Cumulative delta already holds every post-base event (same as player).
        mergedEvents = baseEvents.concat(deltaEvents)
        fromTimeMs = base.fromTimeMs != null
          ? base.fromTimeMs
          : (baseEvents[0] && baseEvents[0].timestamp)
        toTimeMs = source.toTimeMs != null
          ? source.toTimeMs
          : (mergedEvents.length
            ? mergedEvents[mergedEvents.length - 1].timestamp
            : fromTimeMs)
        if (source.name) {
          name = /base/i.test(source.name) ? source.name : `${source.name} (Base)`
        } else {
          name = 'Base'
        }
        if (!imageUrl && base.imageUrl) {
          imageUrl = base.imageUrl
        }
        if (width == null) {
          width = base.width
        }
        if (height == null) {
          height = base.height
        }
      } else {
        httpError(ResponseCodes['400_BAD_REQUEST'], 'Unknown recordingRole')
      }

      if (fromTimeMs == null && mergedEvents[0]) {
        fromTimeMs = mergedEvents[0].timestamp
      }
      if (toTimeMs == null && mergedEvents.length) {
        toTimeMs = mergedEvents[mergedEvents.length - 1].timestamp
      }

      const afterScreenId = req.body && req.body.afterScreenId
        ? String(req.body.afterScreenId)
        : null
      let insertIndex

      if (afterScreenId) {
        const afterDoc = await Models.Screen.findOne({
          _id: afterScreenId,
          storyId,
        }).lean()
        if (!afterDoc) {
          httpError(ResponseCodes['404_NOT_FOUND'], 'afterScreenId not found in this story')
        }
        insertIndex = afterDoc.index + 1
      } else if (source.storyId && String(source.storyId) === String(storyId)) {
        insertIndex = source.index + 1
      } else {
        const last = await Models.Screen.findOne({ storyId }).sort({ index: -1 }).lean()
        insertIndex = last ? last.index + 1 : 0
      }

      await Models.Screen.updateMany(
        { storyId, index: { $gte: insertIndex } },
        { $inc: { index: 1 } },
      )

      const newScreenId = new ObjectId()
      const storyDir = `${ENV.STORIES_FOLDER}/${storyId}`
      await fsp.mkdir(storyDir, { recursive: true })
      const snapshotPath = `${storyDir}/${newScreenId}.rrweb.json`
      await fsp.writeFile(snapshotPath, stringifyRrwebEvents(mergedEvents), {
        encoding: SCREENDOC_ENCODING,
      })

      const newScreenDoc = await new Models.Screen_Page({
        _id: newScreenId,
        name,
        workspaceId,
        userId: authUserDoc.id || authUserDoc._id,
        storyId,
        type: ScreenTypes.SCREEN_PAGE,
        width,
        height,
        imageUrl,
        index: insertIndex,
        recordingRole: 'base',
        snapshotPath,
        eventCount: mergedEvents.length,
        fromTimeMs,
        toTimeMs,
        steps: steps.length
          ? steps
          : [{ view: { content: '<p>Welcome to our StoryDemo!</p>' } }],
      }).save()

      await Models.Story.findOneAndUpdate(
        { _id: storyId },
        { $push: { screens: newScreenId } },
      )

      await Models.Workspace.findOneAndUpdate(
        { _id: workspaceId },
        { $addToSet: { 'library.pages': newScreenId } },
      )

      return newScreenDoc
    })
    .then((screenDoc) => {
      res.set(CORS_HEADERS)
      res.status(ResponseCodes['200_OK'])
      res.send(JSON.stringify(screenDoc))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_SCREEN_BASE_MERGE_FAILED' })

      let resultResponse
      if (error.resultResponse) {
        resultResponse = error.resultResponse
      } else {
        resultResponse = {
          statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
          headers: CORS_HEADERS,
          body: '',
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body)
    })
}

export default handler
