import helpers from '../helpers/livedemoHelpers.js'
import { markUserActivated } from '../helpers/emailHelpers.js'
import flixHelpers from '../helpers/flixHelpers.js'
import postStoriesValidator from '../helpers/validators/stories/postEmptyStory.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import StoryStatuses from '../constants/StoryStatuses.js'
import ScreenTypes from '../constants/ScreenTypes.js'
import ENV from '../envServer.js'
const { STORY_REQUESTS_FOLDER } = ENV
import mongoose from 'mongoose';
const { ObjectId } = mongoose.Types;
import short from 'short-uuid'
import stringify from 'stream-json-stringify'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let requestBody = req.body
  let authUserDoc = null

  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser
      let validatedBody = helpers.validateBody(req.body, postStoriesValidator)
      requestBody = validatedBody.value

      helpers.validateUserHasAccessToWorkspace(authUserDoc, requestBody.workspaceId)
    })
    .then(async () => {

      let name = requestBody.name
      let workspaceId = requestBody.workspaceId

      let capturedEvents = requestBody.capturedEvents
      let videoStartMs = requestBody.videoStartMs
      let videoEndMs = requestBody.videoEndMs
      let aspectRatio = requestBody.aspectRatio
      let tabInfo = requestBody.tabInfo
      let windowMeasures = requestBody.windowMeasures || {innerWidth: 1920, innerHeight: 1080}
      let renderEvents = {}
      let videoId = short.uuid()
      let videoAssetId = ''

      let storyId = new ObjectId()

      let videoUrl = ''
      let screenshots = {}
      let videos = {}

      /*
       return new Models.Story({
        name,
        workspaceId,
        userId: authUserDoc._id
      }).save()
    })
       */

      return new Models.Story({
        _id: storyId,
        name,
        workspaceId,
        userId: authUserDoc.id,
        status: StoryStatuses.READY,
        screens: [],
        capturedEvents,
        aspectRatio,
        videoStartMs,
        videoEndMs,
        tabInfo,
        windowMeasures
      }).save()


    })
    .then((newStory) => {
      logger.info('Story created', { eventName: 'STORY_CREATED' })
      markUserActivated(Models, authUserDoc._id).catch(() => {})

      const resultResponse = {
        statusCode: ResponseCodes['200_OK'],
        headers: {
          'Access-Control-Max-Age': 600,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
          // Required for CORS support to work
          'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(JSON.stringify({
        _id: newStory._id
      }))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_EMPTY_STORY_FAILED' })

      let resultResponse
      if (error.resultResponse) {

        resultResponse = error.resultResponse
      } else {


        resultResponse = {
          statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
            // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
          },
          body: ''
        }

      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body)
    })
}


export default  handler
