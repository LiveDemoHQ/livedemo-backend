import LambdaRateLimiter from 'lambda-rate-limiter'
import ResponseCodes from '../../constants/ResponseCodes.js'
import { httpError } from './http.js'

const limiters = {}

export function clientIp(req) {
    return String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim()
}

// Fixed window per token. Rejects with a 429 httpError.
// ponytail: in-memory per API instance; move to a Mongo/Redis counter when we run >1 instance behind the LB.
export default async function rateLimit(token, limit, intervalMs) {
    if (!limiters[intervalMs]) {
        limiters[intervalMs] = LambdaRateLimiter({ interval: intervalMs, uniqueTokenPerInterval: 5000 })
    }
    await limiters[intervalMs].check(limit, token)
        .catch(() => httpError(ResponseCodes['429_TOO_MANY_REQUESTS'], 'Too many requests, try again later'))
}
