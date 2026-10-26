import ResponseCodes from '../constants/ResponseCodes.js'
import tokenAuthenticateValidator from '../helpers/validators/oldLambdaRoutes/users/tokenAuthenticate.js'
import authUtils from '../helpers/authUtils.js'
import helpers from '../helpers/livedemoHelpers.js'

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
      let validatedBody = helpers.validateBody(requestBody, tokenAuthenticateValidator)
      requestBody = validatedBody.value
    })
    .then(() => {
      const token = requestBody.token

      // Get user by access token
      return authUtils.getUserByAccessToken(token, Models.User, Models.AuthToken)
    })
    .then((userData) => {
      if (!userData) {
        throw new Error('Incorrect token')
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
        featureFlags: userData.featureFlags,
        emailVerified: userData.emailVerified === true,
        token: requestBody.token
      }))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_TOKEN_AUTHENTICATE_FAILED' })

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
            error: 'Incorrect token'
          })
        }

      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default  handler
