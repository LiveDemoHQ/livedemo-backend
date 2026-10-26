import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import postRemoveUserValidator from '../helpers/validators/oldLambdaRoutes/workspaces/postRemoveUser.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo
  let workspaceId = req.params.workspaceId
  let authUserDoc = null
  let requestBody = req.body

  return Promise.resolve().then(async () => {
      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser

      // Verify user is admin of workspace
      const foundWkspace = authUserDoc.workspaces.find(workspace => workspace._id === workspaceId)
      if (!(foundWkspace && foundWkspace.adminUser === authUserDoc._id)) {
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

        let error = new Error('Unauthorized')
        error.resultResponse = resultResponse
        throw error
      }

      // Validate request body
      let validatedBody = helpers.validateBody(requestBody, postRemoveUserValidator)
      if (validatedBody.error) {
        const resultResponse = {
          statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
            // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
          },
          body: JSON.stringify({
            error: validatedBody.error
          })
        }

        let error = new Error('Validation failed')
        error.resultResponse = resultResponse
        throw error
      }

      requestBody = validatedBody.value
    })
    .then(async () => {
      const email = requestBody.email

      // Find workspace with users populated
      return Models.Workspace.findOne({ _id: workspaceId })
        .populate('users')
        .lean()
        .then((workspaceDoc) => {
          let foundUser = workspaceDoc.users.find(user => user.email === email)

          if (foundUser && String(foundUser._id) === String(workspaceDoc.adminUser)) {

            let error = new Error('Cannot remove the workspace admin')
            error.resultResponse = {
              statusCode: ResponseCodes['400_BAD_REQUEST'],
              headers: { 'Access-Control-Allow-Origin': '*' },
              body: JSON.stringify({ error: error.message })
            }
            throw error
          }

          let updateObj = {
            $pull: {
              invitedEmails: email
            }
          }

          if (foundUser) {
            updateObj.$pull.users = foundUser._id
          }

          return Models.Workspace.findOneAndUpdate(
            { _id: workspaceId },
            { ...updateObj },
            { new: true }
          )
            .populate('users adminUser', ['_id', 'name', 'email'])
            .lean()
            .then((workspaceDoc) => {
              if (foundUser) {
                return Models.User.findOneAndUpdate(
                  { _id: foundUser._id },
                  { $pull: { workspaces: workspaceId } }
                )
                  .then(() => {
                    return workspaceDoc
                  })
              } else {
                return workspaceDoc
              }
            })
        })
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
      logger.error(error, { eventName: 'POST_WORKSPACE_REMOVE_USER_FAILED' })

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
          body: JSON.stringify({
            error: error.message
          })
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default  handler
