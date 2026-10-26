import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import forgotPasswordValidator from '../helpers/validators/oldLambdaRoutes/users/forgotPasswordValidator.js'
import { sendEmail } from '../helpers/emails/emailsSender.js'
import Templates from '../helpers/emails/templates/index.js'
import ENV from '../envServer.js'
import authUtils from '../helpers/authUtils.js'
import { assertNotSsoEnforced } from '../helpers/sso.js'
import ipRateLimit from '../helpers/agent/ipRateLimit.js'
import LambdaRateLimiter from 'lambda-rate-limiter'
import { httpError } from '../helpers/agent/http.js'

import logger from '../helpers/logger.js'

const checkIpLimit = ipRateLimit({
  limit: 10,
  interval: 15 * 60 * 1000,
  message: 'Too many password reset requests, please try again later'
})
// Stops one inbox being flooded from many IPs
const emailLimiter = LambdaRateLimiter({ interval: 15 * 60 * 1000, uniqueTokenPerInterval: 5000 })

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let requestBody = null

  return Promise.resolve().then(() => {
      // Validate request body (no authentication required for forgot password)
      let validatedBody = helpers.validateBody(req.body, forgotPasswordValidator)
      requestBody = validatedBody.value
      return checkIpLimit(req)
    })
    .then(() => emailLimiter.check(3, requestBody.email.trim().toLowerCase()).catch(() => {

      httpError(ResponseCodes['429_TOO_MANY_REQUESTS'], 'Too many password reset requests, please try again later')
    }))
    .then(async () => {
      const email = requestBody.email

      // Find user by email
      return Models.User.findOne({ email: email }).lean()
    })
    .then((userDoc) => assertNotSsoEnforced(Models, requestBody.email, userDoc && userDoc._id).then(() => userDoc))
    .then((userDoc) => {
      if (userDoc) {

        // Not awaited, so response time doesn't reveal whether the account exists
        sendForgotPasswordEmail(userDoc, Models).catch((error) => logger.error('forgotPassword email failed', { eventName: 'FORGOTPASSWORD_EMAIL_FAILED', err: error }))
      } else {
        // Return success even if user doesn't exist (security best practice)
        return Promise.resolve()
      }
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
      res.send(JSON.stringify({
        emailSent: true
      }))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_FORGOT_PASSWORD_FAILED' })

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
            message: 'Something wrong happened',
            error: true,
            errorMessage: error.message
          })
        }

      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

function sendForgotPasswordEmail(userDoc, Models) {
  return authUtils.createTokenForChangePassword(userDoc, Models.AuthToken)
    .then((newTokenDoc) => {

      return sendEmail(Templates.changePassword, {
        name: userDoc.name,
        email: userDoc.email,
        changePasswordLink: `${ENV.SERVER_URL}/change-password?token=${newTokenDoc.token}`
      }, [userDoc.email], Models)
    })
}

export default  handler
