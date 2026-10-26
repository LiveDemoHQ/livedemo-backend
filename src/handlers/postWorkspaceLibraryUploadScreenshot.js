import helpers from '../helpers/livedemoHelpers.js'
import flixHelpers from '../helpers/flixHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import ScreenTypes from '../constants/ScreenTypes.js'
import path from 'path'
import short from 'short-uuid'
import postUploadScreenshotValidator from '../helpers/validators/workspaces/library/postUploadScreenshotValidator.js'


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
      let validatedBody = helpers.validateBody(req.body, postUploadScreenshotValidator)

      requestBody = validatedBody.value
    })
    .then(async () => {

      let base64Screenshot = requestBody.base64Screenshot
      let storyId = requestBody.storyId

      if(storyId) {

        return Models.Story.findOne({_id: storyId, workspaceId:workspaceId})
          .lean()
          .then((storyDoc) => {
            let newScreenIndex = storyDoc.screens.length

            let ext = ".png"

            let imageUrl = ''
            let imageName = short.uuid() + ext

            return helpers.uploadImage(base64Screenshot, imageName)
              .then((uploadResult) => {
                logger.info(uploadResult, { eventName: 'POST_WORKSPACE_LIBRARY_UPLOAD_SCREENSHOT' })
                imageUrl = uploadResult.Location

                return imageUrl
              })
              .then((imageUrl) => {

                return new Models.Screen_Screenshot({
                  imageUrl: imageUrl,
                  customTransitions: [],
                  storyId: storyDoc._id,
                  index: newScreenIndex,
                  workspaceId,
                  userId: authUserDoc.id,
                  type: ScreenTypes.SCREEN_SCREENSHOT,
                }).save()
                  .then((insertRes) => insertRes._id)
              })
              .then((screenId) => {
                return Models.Story.findOneAndUpdate({ _id: storyDoc._id }, {
                    $push: { screens: screenId }
                  })
                  .then(() => screenId)
              })
              .then((screenId) => {
                return Models.Workspace.findOneAndUpdate({ _id: workspaceId }, {
                  $push: { 'library.screenshots': screenId }
                })
              })

          })
      } else {

        let ext = ".png"

        let imageUrl = ''
        let imageName = short.uuid() + ext

        return helpers.uploadImage(base64Screenshot, imageName)
          .then((uploadResult) => {
            logger.info(uploadResult, { eventName: 'POST_WORKSPACE_LIBRARY_UPLOAD_SCREENSHOT' })
            imageUrl = uploadResult.Location

            return imageUrl
          })
          .then((imageUrl) => {

            return new Models.Screen_Screenshot({
              imageUrl: imageUrl,
              customTransitions: [],
              storyId: storyId,
              index: 0,
              workspaceId,
              userId: authUserDoc.id,
              type: ScreenTypes.SCREEN_SCREENSHOT,
            }).save()
              .then((insertRes) => insertRes._id)
          })
          .then((screenId) => {
            return Models.Workspace.findOneAndUpdate({ _id: workspaceId }, {
              $push: { 'library.screenshots': screenId }
            })
          })

      }
    })
    .then(() => {

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
      res.send('')
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_WORKSPACE_LIBRARY_UPLOAD_SCREENSHOT_FAILED' })

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
