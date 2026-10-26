import helpers from '../helpers/livedemoHelpers.js'
import flixHelpers from '../helpers/flixHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import ScreenTypes from '../constants/ScreenTypes.js'
import path from 'path'
import short from 'short-uuid'


import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let authUserDoc = null
  let fileBuffer = req.file.buffer
  let mimeType = req.file.mimetype
  let originalName = req.file.originalname

  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(async () => {

      return Models.Story.findOne({ _id: storyId }).lean()
    }).then((storyDoc) => {
      let newScreenIndex = storyDoc.screens.length

      let ext = path.extname(originalName)

      if (mimeType !== 'video/mp4') {
        let imageUrl = ''
        let imageName = short.uuid() + ext

        return helpers.uploadScreenImage(fileBuffer, mimeType, imageName)
          .then((uploadResult) => {
            logger.info(uploadResult, { eventName: 'POST_SCREEN_UPLOAD' })
            imageUrl = uploadResult.Location

            return imageUrl
          })
          .then((imageUrl) => {

            return new Models.Screen_Screenshot({
                imageUrl: imageUrl,
                customTransitions: [],
                index: newScreenIndex,
                workspaceId,
                userId: authUserDoc.id,
                storyId,
                type: ScreenTypes.SCREEN_SCREENSHOT,
              }).save()
              .then((insertRes) => insertRes._id)
          })
          .then((screenId) => {
            return Models.Story.findOneAndUpdate({ _id: storyId }, {
                $push: { screens: screenId }
              })
              .then(() => screenId)
          })
          .then((screenId) => {
            return Models.Workspace.findOneAndUpdate({ _id: workspaceId }, {
              $push: { 'library.screenshots': screenId }
            })
          })

      } else {

        return flixHelpers.uploadMuxVideo(fileBuffer)
          .then((videoRes) => {

            return new Models.Screen_Video({
                asset: videoRes,
                index: newScreenIndex,
                workspaceId,
                userId: authUserDoc.id,
                storyId,
                type: ScreenTypes.SCREEN_VIDEO,
              }).save()
              .then((insertRes) => {
                return insertRes._id
              })
          })
          .then((screenId) => {
            return Models.Story.findOneAndUpdate({ _id: storyId }, {
                $push: { screens: screenId }
              })
              .then(() => screenId)
          })
          .then((screenId) => {
            return Models.Workspace.findOneAndUpdate({ _id: workspaceId }, {
              $push: { 'library.videos': screenId }
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
      logger.error(error, { eventName: 'POST_SCREEN_UPLOAD_FAILED' })

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
