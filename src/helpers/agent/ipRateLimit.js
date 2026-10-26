import LambdaRateLimiter from 'lambda-rate-limiter'
import ResponseCodes from '../../constants/ResponseCodes.js'
import { httpError } from './http.js'

import logger from '../logger.js'

// Cloudflare overwrites cf-connecting-ip; the first x-forwarded-for entry is
// whatever the client sent (Cloudflare appends to it), so it can't key a limit.
// ponytail: a request that skips Cloudflare (straight to the Google LB) can
// forge cf-connecting-ip too. Upgrade: only accept traffic from Cloudflare ranges.
export function clientIp(req) {
  return req.headers['cf-connecting-ip'] ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress || 'unknown'
}

// `limit` hits per IP per `interval` ms (window starts on the IP's first hit).
// ponytail: in-memory per process, so each pod counts on its own. Upgrade: Redis.
export default function ipRateLimit({ limit, interval, message }) {
  const limiter = LambdaRateLimiter({ interval, uniqueTokenPerInterval: 5000 })
  return async function check(req) {
    const ip = clientIp(req)
    await limiter.check(limit, ip).catch(() => {
      logger.info('[rate-limit]', { eventName: 'IP_RATE_LIMIT', data: { detail: [message, ip] } })
      httpError(ResponseCodes['429_TOO_MANY_REQUESTS'], message)
    })
  }
}
