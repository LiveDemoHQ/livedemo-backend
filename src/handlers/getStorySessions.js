import helpers from '../helpers/livedemoHelpers.js'
import postStorySessionEventsValidator from '../helpers/validators/stories/sessions/events/postStorySessionEventsValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import moment from 'moment'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId

  let requestBody = null
  let authUserDoc = null

  let startTimestamp = moment().subtract(30, 'day').valueOf()
  let endTimestamp = moment().valueOf()

  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(() => {
      return Models.Session.find({ storyId: storyId, startTimestamp: { $gte: startTimestamp, $lte: endTimestamp }, },
        '_id storyId workspaceId startTimestamp endTimestamp eventsClickCount createdAt duration stepsCount didPlay didComplete dropOffStep  clientIpData.ip clientIpData.country, clientIpData.city, clientIpData.flag')
        .lean()
    })
    .then((sessionDocs) => {
      if(!sessionDocs) {
        throw new Error('Sessions not found')
      }




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
      res.send(sessionDocs)
    })
    .catch((error) => {
      logger.error(error, { eventName: 'GET_STORY_SESSIONS_FAILED' })

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
