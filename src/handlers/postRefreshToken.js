import ResponseCodes from '../constants/ResponseCodes.js'
import tokenAuthenticateValidator from '../helpers/validators/oldLambdaRoutes/users/tokenAuthenticate.js'
import authUtils from '../helpers/authUtils.js'
import AuthTokenStatuses from '../constants/AuthTokenStatuses.js'
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
      const oldToken = requestBody.token

      // Get user by access token
      return authUtils.getUserByAccessToken(oldToken, Models.User, Models.AuthToken)
    })
    .then((userData) => {
      if (!userData) {
        throw new Error('Incorrect token')
      }

      // Create new token
      return authUtils.createTokenForUser(userData, Models.AuthToken)
        .then((authTokenDoc) => {
          // Expire old token
          return Models.AuthToken.findOneAndUpdate(
            { token: requestBody.token },
            { status: AuthTokenStatuses.EXPIRED }
          )
            .then(() => {
              return {
                authTokenDoc,
                userData
              }
            })
        })
    })
    .then(({ authTokenDoc, userData }) => {
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
        featureFlags: userData.featureFlags,
        emailVerified: userData.emailVerified === true,
        token: authTokenDoc.token
      }))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_REFRESH_TOKEN_FAILED' })

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
