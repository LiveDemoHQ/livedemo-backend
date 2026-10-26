import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import AuthTokenStatuses from '../constants/AuthTokenStatuses.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let authUserDoc = null
  let authToken = null

  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser, authToken: token }) => {
      authUserDoc = authUser
      authToken = token
    })
    .then(() => {
      return Models.AuthToken_User.findOneAndUpdate(
        { userId: authUserDoc._id, token: authToken },
        { status: AuthTokenStatuses.EXPIRED }
      )
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
      logger.error(error, { eventName: 'POST_LOGOUT_FAILED' })

      let resultResponse = {
        statusCode: ResponseCodes['400_BAD_REQUEST'],
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
}

export default  handler
