import ResponseCodes from '../constants/ResponseCodes.js'
import postInstanceAuthenticateValidator from '../helpers/validators/postInstanceAuthenticateValidator.js'
import authUtils from '../helpers/authUtils.js'
import helpers from '../helpers/livedemoHelpers.js'
import {getUserAndTokenByInstanceId} from '../helpers/authHelpers.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let requestBody = req.body

  return Promise.resolve().then(() => {
      if (!requestBody) {
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

        let error = new Error('Invalid request body')
        error.resultResponse = resultResponse
        throw error
      }

      // Validate request body
      let validatedBody = helpers.validateBody(requestBody, postInstanceAuthenticateValidator)
      requestBody = validatedBody.value
    })
    .then(() => {
      const instanceId = requestBody.instanceId

      // Get user by access token
      return getUserAndTokenByInstanceId(instanceId, Models.User, Models.AuthToken)
    })
    .then(({ userData, authToken }) => {
      if (!userData || !authToken) {
        throw new Error('Incorrect instanceId')
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
      res.send(JSON.stringify({
        id: userData._id,
        email: userData.email,
        name: userData.name,
        timezone: userData.timezone,
        workspaceMembers: userData.workspaceMembers,
        workspaces: userData.workspaces,
        subscriptions: userData.subscriptions,
        token: authToken.token
      }))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_INSTANCE_AUTHENTICATE_FAILED' })

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
            error: 'Incorrect instanceId'
          })
        }

      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default  handler
