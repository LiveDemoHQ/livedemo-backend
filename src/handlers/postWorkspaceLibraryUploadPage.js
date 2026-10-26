import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import ScreenTypes from '../constants/ScreenTypes.js'
import short from 'short-uuid'
import mongoose from 'mongoose'
import fsp from 'fs/promises'
import ENV from '../envServer.js'
import { httpError } from '../helpers/rrwebScreenGuards.js'
import { stringifyRrwebEvents } from '../helpers/rrwebEventNames.js'
import postUploadPageValidator from '../helpers/validators/workspaces/library/postUploadPageValidator.js'

import logger from '../helpers/logger.js'

const { ObjectId } = mongoose.Types
const SCREENDOC_ENCODING = 'utf-8'
const RRWEB_FULL_SNAPSHOT = 2

async function ensureStoryDir(storyId) {
  const storyDir = `${ENV.STORIES_FOLDER}/${storyId}`
  try {
    await fsp.access(storyDir)
  } catch {
    await fsp.mkdir(storyDir, { recursive: true })
  }
  return storyDir
}

const handler = function (req, res) {
  let { Models } = req.mongo

  let workspaceId = req.params.workspaceId
  let authUserDoc = null
  let requestBody

  return Promise.resolve().then(async () => {
      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser
      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(() => {
      let validatedBody = helpers.validateBody(req.body, postUploadPageValidator)
      requestBody = validatedBody.value
    })
    .then(async () => {
      const {
        storyId,
        events,
        imageData,
        width,
        height,
        name,
      } = requestBody

      const fullSnapshots = events.filter((e) => e && e.type === RRWEB_FULL_SNAPSHOT)
      if (fullSnapshots.length !== 1) {
        httpError(
          ResponseCodes['400_BAD_REQUEST'],
          'base screen events must contain exactly one FullSnapshot (type 2)'
        )
      }

      const storyDoc = await Models.Story.findOne({ _id: storyId, workspaceId }).lean()
      if (!storyDoc) {
        httpError(ResponseCodes['404_NOT_FOUND'], 'story not found')
      }

      const screenId = new ObjectId()
      const storyDir = await ensureStoryDir(storyId)
      const snapshotPath = `${storyDir}/${screenId}.rrweb.json`

      let imageUrl = ''
      if (imageData) {
        const imageName = short.uuid() + '.png'
        const uploadResult = await helpers.uploadImage(imageData, imageName)
        imageUrl = uploadResult.Location
      }

      await helpers.writeToSystem(snapshotPath, stringifyRrwebEvents(events), SCREENDOC_ENCODING)

      const fromTimeMs = events[0].timestamp
      const toTimeMs = events[events.length - 1].timestamp

      const screenObj = {
        _id: screenId,
        name: name || 'Base',
        workspaceId,
        userId: authUserDoc._id || authUserDoc.id,
        storyId,
        width,
        height,
        imageUrl,
        index: storyDoc.screens.length,
        recordingRole: 'base',
        snapshotPath,
        eventCount: events.length,
        fromTimeMs,
        toTimeMs,
        type: ScreenTypes.SCREEN_PAGE,
        steps: [{
          view: {
            content: '<p>Welcome to our LiveDemo!</p>'
          }
        }],
      }

      const newScreen = await new Models.Screen_Page(screenObj).save()

      await Models.Story.findOneAndUpdate({ _id: storyId }, {
        $push: { screens: newScreen._id }
      })

      await Models.Workspace.findOneAndUpdate({ _id: workspaceId }, {
        $addToSet: { 'library.pages': newScreen._id }
      })

      return newScreen
    })
    .then(() => {
      const resultResponse = {
        statusCode: ResponseCodes['200_OK'],
        headers: {
          'Access-Control-Max-Age': 600,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
          'Access-Control-Allow-Credentials': true,
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send('')
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_WORKSPACE_LIBRARY_UPLOAD_PAGE_FAILED' })

      let resultResponse
      if (error.resultResponse) {
        resultResponse = error.resultResponse
      } else {
        resultResponse = {
          statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
            'Access-Control-Allow-Credentials': true,
          },
          body: ''
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body)
    })
}

export default handler
