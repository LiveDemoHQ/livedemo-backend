import helpers from '../helpers/livedemoHelpers.js'
import flixHelpers from '../helpers/flixHelpers.js'
import postUploadVideoValidator from '../helpers/validators/workspaces/library/postUploadVideoValidator.js'
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
      let validatedBody = helpers.validateBody(req.body, postUploadVideoValidator)

      requestBody = validatedBody.value
    })
    .then(() => {
      let base64Video = requestBody.base64Video
      let storyId = requestBody.storyId

      if (storyId) {

        return Models.Story.findOne({ _id: storyId, workspaceId: workspaceId })
          .lean()
          .then((storyDoc) => {
            let newScreenIndex = storyDoc.screens.length

            return flixHelpers.uploadMuxVideo(base64Video)
              .then((videoUploadRes) => {

                logger.info(videoUploadRes, { eventName: 'POST_WORKSPACE_LIBRARY_UPLOAD_VIDEO' })

                // videoAssetId = videoUploadRes.id
                return new Models.Screen_Video({
                  asset: videoUploadRes,
                  workspaceId,
                  storyId: storyDoc._id,
                  index: newScreenIndex,
                  userId: authUserDoc.id,
                  type: ScreenTypes.SCREEN_VIDEO,
                  steps: []
                }).save()

              })
              .then((screenVideoDoc) => {
                return Models.Story.findOneAndUpdate({ _id: storyDoc._id }, {
                    $push: { screens: screenVideoDoc._id }
                  })
                  .then(() => screenVideoDoc)
              })
              .then((screenVideoDoc) => {

                return Models.Workspace.findOneAndUpdate({ _id: workspaceId }, {
                    $push: { 'library.videos': screenVideoDoc._id }
                  })
                  .then(() => screenVideoDoc)
              })
          })

      } else {

        return flixHelpers.uploadMuxVideo(base64Video)
          .then((videoUploadRes) => {

            logger.info(videoUploadRes, { eventName: 'POST_WORKSPACE_LIBRARY_UPLOAD_VIDEO' })

            // videoAssetId = videoUploadRes.id
            return new Models.Screen_Video({
              asset: videoUploadRes,
              workspaceId,
              userId: authUserDoc.id,
              type: ScreenTypes.SCREEN_VIDEO,
            }).save()

          })
          .then((screenVideoDoc) => {

            return Models.Workspace.findOneAndUpdate({ _id: workspaceId }, {
                $push: { 'library.videos': screenVideoDoc._id }
              })
              .then(() => screenVideoDoc)
          })
      }

    })
    .then(async (screenVideoDoc) => {

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
      res.send(JSON.stringify(screenVideoDoc))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_WORKSPACE_LIBRARY_UPLOAD_VIDEO_FAILED' })

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
