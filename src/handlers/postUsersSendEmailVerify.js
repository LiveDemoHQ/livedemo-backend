import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import LambdaRateLimiter from 'lambda-rate-limiter'
import { createAndSendEmailVerificationCode } from '../helpers/emailHelpers.js'

import logger from '../helpers/logger.js'

const sendEmailVerifyLimiter = LambdaRateLimiter({
  interval: 30000,
  uniqueTokenPerInterval: 500,
})

const handler = function (req, res) {
  let { Models } = req.mongo
  let clientId = req.headers && req.headers.clientid ? req.headers.clientid : 'no-clientid'

  return Promise.resolve()
    .then(() => helpers.authReq(req, Models))
    .then(({ authUser, authToken }) => {
      return sendEmailVerifyLimiter.check(1, authToken)
        .catch(() => {
          logger.info(`Too many send-email-verify requests - clientId=${clientId} - authToken=${authToken}`, { eventName: 'POST_USERS_SEND_EMAIL_VERIFY' })

          const failedRateLimitError = new Error('Rate limit exceeded')
          failedRateLimitError.resultResponse = {
            statusCode: ResponseCodes['429_TOO_MANY_REQUESTS'],
            headers: {
              'Access-Control-Max-Age': 600,
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
              'Access-Control-Allow-Credentials': true,
            },
          }
          throw failedRateLimitError
        })
        .then(() => authUser)
    })
    .then((authUser) => {
      if (authUser.emailVerified === true) {
        const resultResponse = {
          statusCode: ResponseCodes['200_OK'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
            'Access-Control-Allow-Credentials': true,
          },
        }

        res.set(resultResponse.headers)
        res.status(resultResponse.statusCode)
        res.send(JSON.stringify({ emailSent: false, alreadyVerified: true }))
        return null
      }

      return createAndSendEmailVerificationCode(authUser, Models)
    })
    .then((result) => {
      if (result === null) {
        return
      }

      const resultResponse = {
        statusCode: ResponseCodes['200_OK'],
        headers: {
          'Access-Control-Max-Age': 600,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
          'Access-Control-Allow-Credentials': true,
        },
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(JSON.stringify({ emailSent: true }))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_USERS_SEND_EMAIL_VERIFY_FAILED' })

      let resultResponse
      if (error.resultResponse) {
        resultResponse = error.resultResponse
      } else {
        resultResponse = {
          statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
            'Access-Control-Allow-Credentials': true,
          },
          body: JSON.stringify({
            message: 'Something wrong happened',
            error: true,
            errorMessage: error.message,
          }),
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default handler
