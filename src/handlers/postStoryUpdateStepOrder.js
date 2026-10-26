import helpers from '../helpers/livedemoHelpers.js'
import postUpdateStepOrder from '../helpers/validators/stories/postUpdateStepOrderValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { httpError } from '../helpers/rrwebScreenGuards.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models } = req.mongo

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let screenId = req.params.screenId
  let authUserDoc = null

  return Promise.resolve().then(async () => {
      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser

      let validatedBody = helpers.validateBody(req.body, postUpdateStepOrder)
      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)

      return validatedBody.value
    })
    .then(async (requestBody) => {
      let steps = requestBody.steps

      let screen = await Models.Screen.findOne({ _id: screenId, storyId }).lean()
      if (!screen) {
        httpError(ResponseCodes['404_NOT_FOUND'], 'Screen not found')
      }

      if (!screen.steps || screen.steps.length !== steps.length) {
        httpError(ResponseCodes['400_BAD_REQUEST'], 'Step count mismatch')
      }

      let stepMap = new Map(screen.steps.map((step) => [String(step._id), step]))
      let reorderedSteps = steps.map(({ _id, index }) => {
        let existing = stepMap.get(String(_id))
        if (!existing) {
          httpError(ResponseCodes['400_BAD_REQUEST'], 'Unknown step id')
        }

        return {
          ...existing,
          index,
        }
      })

      return Models.Screen.updateOne({ _id: screenId }, { $set: { steps: reorderedSteps } })
    })
    .then(() => {
      const resultResponse = {
        statusCode: ResponseCodes['200_OK'],
        headers: {
          'Access-Control-Max-Age': 600,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
          'Access-Control-Allow-Credentials': true,
        },
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send()
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_STORY_UPDATE_STEP_ORDER_FAILED' })

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
          body: '',
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body)
    })
}

export default handler
