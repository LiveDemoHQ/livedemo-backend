import helpers from '../helpers/livedemoHelpers.js'
import postUpdateScreenOrder from '../helpers/validators/stories/postUpdateScreenOrderValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { httpError, wouldBreakRrwebChainOrder } from '../helpers/rrwebScreenGuards.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let requestBody = null

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let authUserDoc = null

  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser

      let validatedBody = helpers.validateBody(req.body, postUpdateScreenOrder)
      requestBody = validatedBody.value

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(async () => {
      let screens = requestBody.screens

      // Load recording metadata for proposed order validation
      const screenIds = screens.map((s) => s._id)
      const screenDocs = await Models.Screen.find({ _id: { $in: screenIds }, storyId }).lean()
      const byId = new Map(screenDocs.map((s) => [String(s._id), s]))

      const proposed = screens.map((s) => {
        const doc = byId.get(String(s._id)) || {}
        return {
          _id: s._id,
          index: s.index,
          recordingRole: doc.recordingRole,
          baseScreenId: doc.baseScreenId,
        }
      })

      const breakReason = wouldBreakRrwebChainOrder(proposed)
      if (breakReason) {
        httpError(ResponseCodes['409_CONFLICT'], breakReason)
      }

      let updateOps = []
      screens.forEach((screen) => {

        updateOps.push({
          updateOne: {
            filter: {
              _id: screen._id,
            },
            update: {
              index: screen.index,
            }
          }
        })
      })


      return Models.Screen.bulkWrite(updateOps)
    })
    .then((writeResult) => {

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
      res.send()
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_STORY_UPDATE_SCREEN_ORDER_FAILED' })

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

export default  handler
