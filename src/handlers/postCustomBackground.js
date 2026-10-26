import helpers from '../helpers/livedemoHelpers.js'
import postCustomBackgroundValidator from '../helpers/validators/stories/custom/postCustomBackgroundValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models } = req.mongo

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let requestBody = null
  let authUserDoc = null

  return Promise.resolve()
    .then(async () => {
      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser
      let validatedBody = helpers.validateBody(req.body, postCustomBackgroundValidator)
      requestBody = validatedBody.value

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(async () => {
      let isActive = requestBody.isActive
      let backgroundColor = requestBody.backgroundColor
      let backgroundBlur = requestBody.backgroundBlur
      let backgroundType = requestBody.backgroundType
      let wallpaperImage = requestBody.wallpaperImage
      let padding = requestBody.padding

      return Models.Story.findOneAndUpdate(
        {
          _id: storyId
        },
        {
          $set: {
            'custom.background.isActive': isActive,
            'custom.background.backgroundColor': backgroundColor,
            'custom.background.backgroundBlur': backgroundBlur,
            'custom.background.backgroundType': backgroundType,
            'custom.background.wallpaperImage': wallpaperImage,
            'custom.background.padding': padding
          }
        },
        { new: true }
      )
    })
    .then((newStoryDoc) => {
      const resultResponse = {
        statusCode: ResponseCodes['200_OK'],
        headers: {
          'Access-Control-Max-Age': 600,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
          'Access-Control-Allow-Credentials': true
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(JSON.stringify(newStoryDoc.custom.background))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_CUSTOM_BACKGROUND_FAILED' })

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
            'Access-Control-Allow-Credentials': true
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
