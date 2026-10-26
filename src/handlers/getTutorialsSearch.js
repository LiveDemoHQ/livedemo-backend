import ResponseCodes from '../constants/ResponseCodes.js'
import LambdaRateLimiter from 'lambda-rate-limiter'

import logger from '../helpers/logger.js'

const CORS_HEADERS = {
    'Access-Control-Max-Age': 600,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
    'Access-Control-Allow-Credentials': true,
}

// 5 requests per second per IP — interval 1000 ms, limit 5
const ipLimiter = LambdaRateLimiter({
    interval: 1000,
    uniqueTokenPerInterval: 2000,
})

const MAX_RESULTS = 8
const FEATURED_LIMIT = 24
const DEFAULT_PAGE_SIZE = 12
const MAX_PAGE_SIZE = 50

const handler = async function (req, res) {
    const { Models } = req.mongo

    // Resolve client IP (support proxies)
    const clientIp =
        (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
        req.socket?.remoteAddress ||
        'unknown'

    return Promise.resolve()
        .then(() => {
            return ipLimiter.check(5, clientIp)
        })
        .catch(() => {
            const resultResponse = {
                statusCode: ResponseCodes['429_TOO_MANY_REQUESTS'],
                headers: CORS_HEADERS,
                body: JSON.stringify({ error: 'Too many requests' }),
            }
            res.set(resultResponse.headers)
            res.status(resultResponse.statusCode)
            res.send(resultResponse.body)
            // Sentinel to stop the chain
            throw Object.assign(new Error('rate-limited'), { handled: true })
        })
        .then(async () => {
            const q = (req.query.q || '').trim()
            const featured = req.query.featured === 'true'

            // Parse pagination params — used for both ?featured and ?q flows
            const page = Math.max(1, parseInt(req.query.page, 10) || 1)
            const limit = Math.min(
                MAX_PAGE_SIZE,
                Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE),
            )
            const skip = (page - 1) * limit

            // ?featured=true — return latest tutorials that have an image, paginated
            if (featured) {
                const category = (req.query.category || '').trim()
                const filter = {
                    draft: { $ne: true },
                    image: { $nin: [null, ''] },
                    ...(category && { category }),
                }
                const projection = { title: 1, slug: 1, image: 1, category: 1 }

                const [results, total] = await Promise.all([
                    Models.Tutorial.find(filter, projection)
                        .sort({ publishedAt: -1 })
                        .skip(skip)
                        .limit(limit)
                        .lean(),
                    Models.Tutorial.countDocuments(filter),
                ])

                return { results, total, page, limit }
            }

            if (q.length < 2) {
                return { results: [], total: 0, page, limit }
            }

            // Build a case-insensitive regex that requires every word to appear
            const words = q.split(/\s+/).filter(Boolean)
            const regexParts = words.map((w) => `(?=.*${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`)
            const regex = new RegExp(regexParts.join(''), 'i')
            const filter = { title: regex, draft: { $ne: true } }
            const projection = { title: 1, slug: 1, image: 1, category: 1 }

            const [results, total] = await Promise.all([
                Models.Tutorial.find(filter, projection)
                    .sort({ publishedAt: -1 })
                    .skip(skip)
                    .limit(Math.min(limit, MAX_RESULTS))
                    .lean(),
                Models.Tutorial.countDocuments(filter),
            ])

            return { results, total, page, limit: Math.min(limit, MAX_RESULTS) }
        })
        .then(({ results, total, page, limit }) => {
            const totalPages = Math.ceil(total / limit) || 1
            res.set(CORS_HEADERS)
            res.status(ResponseCodes['200_OK'])
            res.send(JSON.stringify({ results, total, page, totalPages }))
        })
        .catch((error) => {
            if (error.handled) return

            logger.error('[getTutorialsSearch]', { eventName: 'GET_TUTORIALS_SEARCH_FAILED', err: error })

            res.set(CORS_HEADERS)
            res.status(ResponseCodes['500_INTERNAL_SERVER_ERROR'])
            res.send(JSON.stringify({ error: 'Internal server error' }))
        })
}

export default handler
