import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import moment from 'moment'

import logger from '../helpers/logger.js'

const VIEW_TYPES = {
  '48H': '48H',
  '7D': '7D',
  '30D': '30D',
}

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let workspaceId = req.params.workspaceId
  let viewType = VIEW_TYPES[req.query.viewType]

  let requestBody = null
  let authUserDoc = null

  let subtractDays = viewType === VIEW_TYPES['48H'] ? 2 : (viewType === VIEW_TYPES['7D'] ? 7 : 30)

  let startTimestamp = moment().subtract(subtractDays, 'day').valueOf()
  let endTimestamp = moment().valueOf()



  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(() => {
      return Models.Lead.find({ workspaceId: workspaceId, createdAt: { $gte: startTimestamp, $lte: endTimestamp }, },
        '_id storyId agentId workspaceId createdAt sessionId data')
        .populate({
          path: 'storyId',
          select: '_id name ',
        })
        .populate({
          path: 'agentId',
          select: '_id name',
        })
        .populate({
          path: 'sessionId',
          select: '_id clientIpData.country clientIpData.flag.emoji',
        })
        .sort({createdAt: -1})
        .lean()
    })
    .then((leadDocs) => {
      if(!leadDocs) {
        throw new Error('Leads not found')
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
      res.send(leadDocs)
    })
    .catch((error) => {
      logger.error(error, { eventName: 'GET_WORKSPACE_LEADS_FAILED' })

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
