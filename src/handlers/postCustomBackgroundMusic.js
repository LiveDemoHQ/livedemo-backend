import helpers from '../helpers/livedemoHelpers.js'
import postCustomBackgroundMusicValidator from '../helpers/validators/stories/custom/postCustomBackgroundMusicValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let requestBody = null
  let authUserDoc = null

  return Promise.resolve().then(async () => {
      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser
      let validatedBody = helpers.validateBody(req.body, postCustomBackgroundMusicValidator)
      requestBody = validatedBody.value

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(async () => {
      let isActive = requestBody.isActive
      let backgroundMusicVolume = requestBody.backgroundMusicVolume
      let backgroundMusicUrl = requestBody.backgroundMusicUrl

      const $set = {
        'custom.backgroundMusic.isActive': isActive,
        'custom.backgroundMusic.backgroundMusicVolume': backgroundMusicVolume,
      }

      if (backgroundMusicUrl !== undefined) {
        $set['custom.backgroundMusic.backgroundMusicUrl'] = backgroundMusicUrl
      }

      return Models.Story.findOneAndUpdate({ _id: storyId }, { $set }, { new: true })
    })
    .then((newStoryDoc) => {
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
      res.send(JSON.stringify(newStoryDoc.custom.backgroundMusic))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_CUSTOM_BACKGROUND_MUSIC_FAILED' })

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
