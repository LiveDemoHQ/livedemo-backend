import ResponseCodes from '../constants/ResponseCodes.js'
import limiter from '../helpers/rateLimiter.js'
import { buildGoogleLoginLink } from '../helpers/googleAuthLinkHelpers.js'

import logger from '../helpers/logger.js'

function corsHeaders() {
  return {
    'Access-Control-Max-Age': 600,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
    'Access-Control-Allow-Credentials': true
  }
}

const handler = function (req, res) {
  return Promise.resolve()
    .then(() => {
      const clientId = req.headers?.clientid || 'publicClient'
      const token = req.headers?.authorization || 'publicClient'

      return limiter(
        clientId,
        token,
        (errorResponse) => {
          const failedRateLimitError = new Error('Rate limit exceeded')
          failedRateLimitError.resultResponse = errorResponse
          throw failedRateLimitError
        }
      )
    })
    .then(() => {
      const loginLink = buildGoogleLoginLink(req.query.returnTo, req.query.browserSessionId)

      if (!loginLink) {
        const error = new Error('Google OAuth not configured')
        error.resultResponse = {
          statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
          headers: corsHeaders()
        }
        throw error
      }

      const resultResponse = {
        statusCode: ResponseCodes['302_FOUND'],
        headers: {
          ...corsHeaders(),
          Location: loginLink
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.redirect(loginLink)
    })
    .catch((err) => {
      logger.error(err, { eventName: 'GET_USERS_AUTH_GOOGLE_LINK_FAILED' })

      let resultResponse
      if (err.resultResponse) {
        resultResponse = err.resultResponse
      } else {
        resultResponse = {
          statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
          headers: corsHeaders()
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default handler
