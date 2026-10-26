import * as ENV from "../envServer.js"
const REQUESTS_PER_INTERVAL = parseInt(ENV.REQUESTS_PER_INTERVAL) || 30
import * as  ResponseCodes from "../constants/ResponseCodes.js"
import LambdaRateLimiter from "lambda-rate-limiter"

import logger from './logger.js'

const limiter = LambdaRateLimiter({
  interval: parseInt(process.env.RATE_INTERVAL) || 10000, // rate limit interval in ms, starts on first request
  uniqueTokenPerInterval: 500 // excess causes earliest seen to drop, per instantiation
})

export default function (clientId, token, callback, rpsPerInterval = REQUESTS_PER_INTERVAL) {
  return limiter.check(rpsPerInterval, token)
    .catch(err => {
      logger.info(`Too many requests from this user - clientId=${clientId} - authToken=${token}`, { eventName: 'RATE_LIMITER' })
      logger.error(err, { eventName: 'RATE_LIMITER_FAILED' })

      let exceededResponse = {
          statusCode: ResponseCodes["429_TOO_MANY_REQUESTS"],
          headers: {
            "Access-Control-Max-Age": 600,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "ClientId,Authorization,Content-Type,Accept", // Required for CORS support to work
            // Required for CORS support to work
            "Access-Control-Allow-Credentials": true, // Required for cookies, authorization headers with HTTPS
          }
      }

      callback(null, exceededResponse)
    })
    .then((tokenCounts) => {
      return Promise.resolve(tokenCounts)
    })
}
