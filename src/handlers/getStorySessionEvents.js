import helpers from '../helpers/livedemoHelpers.js'
import postStorySessionEventsValidator from '../helpers/validators/stories/sessions/events/postStorySessionEventsValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let sessionId = req.params.sessionId
  let requestBody = null
  let authUserDoc = null

  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser
      let validatedBody = helpers.validateBody(req.body, postStorySessionEventsValidator)
      requestBody = validatedBody.value

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(() => {
      return Models.Session.findOne({ _id: sessionId }).lean()
    })
    .then((sessionDoc) => {
      if(!sessionDoc) {
        throw new Error('Session not found')
      }



      // No low event cap: iframe contents are attached via later mutation events
      // (isAttachIframe). Truncating the stream leaves Analytics with an empty
      // iframe shell (chrome/tooltips play, demo surface stays white).
      return Models.SessionEvent.find({
        workspaceId: workspaceId,
        sessionId: sessionDoc._id,
      }).sort({ 'eventData.timestamp': 1 }).lean()
    })
    .then((sessionEvents) => {

      let deserializedEvents = sessionEvents.map((event) => {
        event.eventData.data = JSON.parse(event.eventData.data)
        event.eventData.stepIndex = event.stepIndex
        return event.eventData
      })

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
      res.send(deserializedEvents)
    })
    .catch((error) => {
      logger.error(error, { eventName: 'GET_STORY_SESSION_EVENTS_FAILED' })

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
