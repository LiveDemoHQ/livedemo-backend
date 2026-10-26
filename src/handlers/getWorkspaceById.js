import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { normalizeSubscriptions } from '../helpers/subscriptionHelpers.js'

import logger from '../helpers/logger.js'

// Simple subscription type ranking for sorting
const SubscriptionTypesRank = {
  'startup_monthly': 0,
  'startup_annually': 1,
  'pro_annually': 3,
  'pro_monthly': 4,
  'business_monthly': 5,
  'business_annually': 6,
}

function sortSubscriptionTypes(subFirst, subSecond) {
  return (SubscriptionTypesRank[subSecond.type] || 0) - (SubscriptionTypesRank[subFirst.type] || 0)
}

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let workspaceId = req.params.workspaceId
  let authUserDoc = null

  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(async () => {

      return Models.Workspace.findOne({ 
        _id: workspaceId 
      })
      .populate('users adminUser', [
        '_id',
        'name',
        'email',
      ])
      .populate('subscriptions')
      .lean()
    })
    .then((workspaceDoc) => {
      if (!workspaceDoc) {
        const resultResponse = {
          statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
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
        res.send('')
        return
      }

      // Filter subscriptions to only active ones and sort them
      if (workspaceDoc.subscriptions && Array.isArray(workspaceDoc.subscriptions)) {
        workspaceDoc.subscriptions = normalizeSubscriptions(
          workspaceDoc.subscriptions
            .filter(sub => sub.active)
            .sort(sortSubscriptionTypes)
        )
      } else {
        workspaceDoc.subscriptions = []
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
      res.send(JSON.stringify(workspaceDoc))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'GET_WORKSPACE_BY_ID_FAILED' })

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
