import ResponseCodes from '../constants/ResponseCodes.js'
import postAuthorizeInstanceValidator from '../helpers/validators/postAuthorizeInstanceValidator.js'
import authUtils from '../helpers/authUtils.js'
import helpers from '../helpers/livedemoHelpers.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let requestBody = null
  let authUserDoc = null
  let tokenString = null

  return Promise.resolve()
    .then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser, authToken }) => {
      authUserDoc = authUser
      tokenString = authToken

      
      // Validate request body
      let validatedBody = helpers.validateBody(req.body, postAuthorizeInstanceValidator)
      requestBody = validatedBody.value
    })
    .then(() => {
      return authUtils.authorizeInstance(requestBody.instanceId, tokenString, Models.AuthToken)
    })

    .then((tokenDoc) => {
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
        authorized: true
      }))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_AUTHORIZE_INSTANCE_FAILED' })

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
            error: error.message || 'Incorrect Email Or Password'
          })
        }

      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default handler
