import crypto from 'crypto'
import ENV from '../envServer.js'
import ResponseCodes from '../constants/ResponseCodes.js'

import logger from './logger.js'

// /internal/* routes (called by livedemo-ai-api): `Authorization: Internal <INTERNAL_API_KEY>`, never a user token.
// The key is their only protection (they stay reachable on the public host), so an empty key always fails
export function isInternalRequest(req) {

    const expected = Buffer.from(`Internal ${ENV.INTERNAL_API_KEY}`)
    const given = Buffer.from(String(req.get('Authorization') || ''))
    return !!ENV.INTERNAL_API_KEY && given.length === expected.length && crypto.timingSafeEqual(given, expected)
}

// Express handler wrapper: 401 unless internal; no CORS headers. Errors with resultResponse keep their status
export default function internalRoute(fn) {

    return (req, res) => Promise.resolve()
        .then(() => {

            if (!isInternalRequest(req)) {

                const error = new Error('Unauthorized')
                error.resultResponse = { statusCode: ResponseCodes['401_UNAUTHORIZED'], body: JSON.stringify({ message: 'Unauthorized' }) }
                throw error
            }
            return fn(req, res)
        })
        .catch((error) => {

            const result = error.resultResponse
            if (!result) {

                logger.error('[internal]', { eventName: 'INTERNAL_AUTH_FAILED', err: error })
            }
            res.status(result ? result.statusCode : ResponseCodes['500_INTERNAL_SERVER_ERROR'])
            res.send(result ? result.body : '')
        })
}
