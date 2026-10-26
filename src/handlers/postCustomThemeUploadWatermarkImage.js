import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import path from 'path'
import short from 'short-uuid'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let authUserDoc = null
  let imageBuffer = req.file.buffer
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
      let imageUrl = ''
      let ext = path.extname(originalName)
      let imageName = short.uuid() + ext

      return helpers.uploadBufferImage(imageBuffer, mimeType, imageName)
        .then((uploadResult) => {
          logger.info(uploadResult, { eventName: 'POST_CUSTOM_THEME_UPLOAD_WATERMARK_IMAGE' })
          imageUrl = uploadResult.Location

          return imageUrl
        })
    })
    .then((imageUrl) => {

      return Models.Story.findOneAndUpdate({
          _id: storyId
        }, {
          $set: {
            'custom.theme.watermarkConfig.imageUrl': imageUrl,
          }
        }, { new: true })
        .then(() => {

          return imageUrl
        })
    })
    .then((imageUrl) => {

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
      res.send(JSON.stringify({ imageUrl }))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_CUSTOM_THEME_UPLOAD_WATERMARK_IMAGE_FAILED' })

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
