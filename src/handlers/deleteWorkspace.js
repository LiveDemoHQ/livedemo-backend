import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import EventReporter from '../helpers/eventReporter.js'
import EventNamesEnum from '../constants/EventNamesEnum.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo
  let workspaceId = req.params.workspaceId
  let authUserDoc = null

  return Promise.resolve().then(async () => {
      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser

      // Verify user has access to workspace
      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(async () => {
      // Find workspace
      return Models.Workspace.findOne({ _id: workspaceId })
        .populate('members', ['_id', 'workspaceId', 'name', 'userId', 'role', 'slackAccessTokens', 'isBot', 'featureFlags'])
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

        let error = new Error('Workspace not found')
        error.resultResponse = resultResponse
        throw error
      }

      if (!workspaceDoc.adminUser || workspaceDoc.adminUser.toString() !== authUserDoc._id.toString()) {
        const resultResponse = {
          statusCode: ResponseCodes['400_BAD_REQUEST'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
            // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
          }
        }

        let error = new Error('User is not admin')
        error.resultResponse = resultResponse
        throw error
      }

      // Delete workspace - remove workspace from all users
      return Models.User.updateMany(
        { workspaces: { $in: [workspaceId] } },
        { $pull: { workspaces: workspaceId } }
      )
    })
    .then(() => {
      // AI Demo Agents: soft-delete the agents and hard-delete their vectors +
      // sources so no chunk can be retrieved after the workspace is gone
      return Promise.all([
        Models.AiDemoAgent.updateMany({ workspaceId }, { $set: { deletedAt: new Date() } }),
        Models.AgentKnowledgeChunk.deleteMany({ workspaceId }),
        Models.AgentKnowledgeSource.deleteMany({ workspaceId }),
        Models.ChecklistProgress.deleteMany({ workspaceId }),
      ])
    })
    .then(() => {
      // Report event
      return EventReporter.storeInfoEvent(EventNamesEnum.WORKSPACE_DELETED, {
        userId: authUserDoc._id,
        workspaceId: workspaceId
      })
    })
    .then(() => {
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
      res.send('')
    })
    .catch((error) => {
      logger.error(error, { eventName: 'DELETE_WORKSPACE_FAILED' })

      let resultResponse
      if (error.resultResponse) {
        resultResponse = error.resultResponse
      } else {
        resultResponse = {
          statusCode: ResponseCodes['400_BAD_REQUEST'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
            // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
          },
          body: JSON.stringify({
            error: error.message || 'Something went wrong, please try again'
          })
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default  handler
