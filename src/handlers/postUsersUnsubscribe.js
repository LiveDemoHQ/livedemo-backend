import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import unsubscribeValidator from '../helpers/validators/oldLambdaRoutes/users/unsubscribeValidator.js'
import LambdaRateLimiter from 'lambda-rate-limiter'
import { unsubscribeSubscriber } from '../helpers/sequenzy/sequenzyClient.js'

import logger from '../helpers/logger.js'

const corsHeaders = {
  'Access-Control-Max-Age': 600,
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
  'Access-Control-Allow-Credentials': true,
}

// 5 requests per minute per IP
const ipLimiter = LambdaRateLimiter({
  interval: 60000,
  uniqueTokenPerInterval: 2000,
})

const handler = function (req, res) {
  let { Models } = req.mongo
  let requestBody = null

  const clientIp =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'

  return Promise.resolve()
    .then(() => {
      return ipLimiter.check(5, clientIp)
    })
    .catch(() => {
      const error = new Error('Rate limit exceeded')
      error.resultResponse = {
        statusCode: ResponseCodes['429_TOO_MANY_REQUESTS'],
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: 'Too many requests',
        }),
      }
      throw error
    })
    .then(() => {
      let validatedBody = helpers.validateBody(req.body, unsubscribeValidator)
      requestBody = validatedBody.value
    })
    .then(() => {
      return Models.User.findOne({
        'emailConfig.unsubscribeToken': requestBody.token,
      })
    })
    .then((userData) => {
      if (!userData) {
        const error = new Error('Invalid unsubscribe link')
        error.resultResponse = {
          statusCode: ResponseCodes['404_NOT_FOUND'],
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'Invalid unsubscribe link',
          }),
        }
        throw error
      }

      return Models.User.findOneAndUpdate(
        { _id: userData._id },
        {
          $set: {
            'emailConfig.isSubscribed': false,
            'emailConfig.unsubscribedAt': new Date(),
          },
        },
        { new: true }
      )
    })
    .then((updatedUser) => {
      // Fire-and-forget — LiveDemo unsubscribe already succeeded.
      void unsubscribeSubscriber(updatedUser || {}).catch(() => {})
      res.set(corsHeaders)
      res.status(ResponseCodes['200_OK'])
      res.send(JSON.stringify({
        success: true,
      }))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_USERS_UNSUBSCRIBE_FAILED' })

      let resultResponse
      if (error.resultResponse) {
        resultResponse = error.resultResponse
      } else {
        resultResponse = {
          statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'Something went wrong, please try again',
          }),
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default handler
