import ResponseCodes from '../constants/ResponseCodes.js'
import LambdaRateLimiter from 'lambda-rate-limiter'

import logger from '../helpers/logger.js'

const corsHeaders = {
  'Access-Control-Max-Age': 600,
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
  'Access-Control-Allow-Credentials': true,
}

// 2 requests per second per IP
const ipLimiter = LambdaRateLimiter({
  interval: 1000,
  uniqueTokenPerInterval: 5000,
})

const handler = function (req, res) {
  const { Models } = req.mongo
  const { id } = req.params

  const clientIp =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'

  return Promise.resolve()
    .then(() => ipLimiter.check(2, clientIp))
    .catch(() => {
      const err = new Error('Rate limit exceeded')
      err.resultResponse = {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Too many requests. Please try again shortly.' }),
      }
      throw err
    })
    .then(() => Models.LaunchConfig.findById(id).lean())
    .then((doc) => {
      if (!doc) {
        const err = new Error('Not found')
        err.resultResponse = {
          statusCode: ResponseCodes['404_NOT_FOUND'],
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Launch config not found' }),
        }
        throw err
      }
      res.set(corsHeaders)
      res.status(ResponseCodes['200_OK'])
      res.send(JSON.stringify({
        _id: doc._id,
        name: doc.name,
        totalSpots: doc.totalSpots,
        spotsTaken: doc.spotsTaken,
        spotsRemaining: Math.max(0, doc.totalSpots - doc.spotsTaken),
        launchDate: doc.launchDate || null,
      }))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'GET_LAUNCH_CONFIG_FAILED' })
      const resultResponse = error.resultResponse || {
        statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Something went wrong' }),
      }
      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default handler
