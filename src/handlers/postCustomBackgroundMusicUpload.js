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
  let audioBuffer = req.file.buffer
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
      let ext = path.extname(originalName)
      let audioName = short.uuid() + ext

      return helpers.uploadBufferBackgroundAudio(audioBuffer, mimeType, audioName)
        .then((uploadResult) => {
          logger.info(uploadResult, { eventName: 'POST_CUSTOM_BACKGROUND_MUSIC_UPLOAD' })
          return uploadResult.Location
        })
    })
    .then((audioUrl) => {
      return Models.Story.findOneAndUpdate({
          _id: storyId
        }, {
          $set: {
            'custom.backgroundMusic.backgroundMusicUrl': audioUrl,
          }
        }, { new: true })
        .then(() => audioUrl)
    })
    .then((audioUrl) => {
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
      res.send(JSON.stringify({ audioUrl }))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_CUSTOM_BACKGROUND_MUSIC_UPLOAD_FAILED' })

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
