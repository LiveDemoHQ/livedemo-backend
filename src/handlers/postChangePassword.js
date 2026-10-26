import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import changePasswordValidator from '../helpers/validators/oldLambdaRoutes/users/changePasswordValidator.js'
import authUtils from '../helpers/authUtils.js'
import AuthTokenStatuses from '../constants/AuthTokenStatuses.js'
import { httpError } from '../helpers/agent/http.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let requestBody = null

  return Promise.resolve().then(() => {
      const authToken = String(req.get('Authorization') || '').split(' ')[1]
      if (!authToken) {

        httpError(ResponseCodes['401_UNAUTHORIZED'], 'Missing reset token')
      }

      // Validate before consuming so a bad body doesn't burn the link
      requestBody = helpers.validateBody(req.body, changePasswordValidator).value

      return authUtils.consumeChangePasswordToken(authToken, Models.AuthToken)
    })
    .then((tokenDoc) => {
      if (!tokenDoc) {

        httpError(ResponseCodes['400_BAD_REQUEST'], 'This reset link is invalid or has expired. Please request a new one.')
      }

      return Models.User.findOne({ _id: tokenDoc.userId }).lean()
    })
    .then((userData) => {
      if (!userData) {

        httpError(ResponseCodes['400_BAD_REQUEST'], 'This reset link is invalid or has expired. Please request a new one.')
      }

      return authUtils.generateHash(requestBody.newPassword)
        .then((newPassHash) => Models.User.updateOne({ _id: userData._id }, { password: newPassHash }))
        // Sign out every existing session and kill any other reset links
        .then(() => Promise.all([
          Models.AuthToken_User.updateMany({ userId: userData._id, status: AuthTokenStatuses.ACTIVE }, { status: AuthTokenStatuses.EXPIRED }),
          Models.AuthToken_UserChangePassword.updateMany({ userId: userData._id, status: AuthTokenStatuses.ACTIVE }, { status: AuthTokenStatuses.EXPIRED })
        ]))
        .then(() => authUtils.createTokenForUser(userData, Models.AuthToken))
        .then((authTokenDoc) => ({ userData, authTokenDoc }))
    })
    .then(({ userData, authTokenDoc }) => {
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
        token: authTokenDoc.token
      }))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_CHANGE_PASSWORD_FAILED' })

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
            error: 'Something went wrong, please try again'
          })
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default  handler
