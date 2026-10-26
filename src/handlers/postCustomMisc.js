import helpers from '../helpers/livedemoHelpers.js'
import postCustomMiscValidator from '../helpers/validators/stories/custom/postCustomMiscValidator.js'
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
        let validatedBody = helpers.validateBody(req.body, postCustomMiscValidator)
        requestBody = validatedBody.value

        helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
      })
      .then(async () => {
        let isActive = requestBody.isActive
        let confettiOnLastStep = requestBody.confettiOnLastStep
        let isOmniBarDisabled = requestBody.isOmniBarDisabled
        let isLiveDemoWatermarkEnabled = requestBody.isLiveDemoWatermarkEnabled
        let isTabsEnabled = requestBody.isTabsEnabled

        return Models.Story.findOneAndUpdate({
          _id: storyId
        }, {
          $set: {
            'custom.misc.isActive': isActive,
            'custom.misc.confettiOnLastStep': confettiOnLastStep,
            'custom.misc.isOmniBarDisabled': isOmniBarDisabled,
            'custom.misc.isTabsEnabled': isTabsEnabled,
            'custom.misc.isLiveDemoWatermarkEnabled': isLiveDemoWatermarkEnabled,
            ...(requestBody.customCursor !== undefined ? { 'custom.misc.customCursor': requestBody.customCursor } : {})
          }
        }, { new: true })
      })
      .then((newStoryDoc) => {

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
        res.send(JSON.stringify(newStoryDoc.custom.misc))
      })
      .catch((error) => {
        logger.error(error, { eventName: 'POST_CUSTOM_MISC_FAILED' })

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
