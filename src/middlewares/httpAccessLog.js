import logger from '../helpers/logger.js'

const BODY_MAX = 256
const REDACT_KEYS = new Set([
    'password',
    'passwd',
    'token',
    'authorization',
    'secret',
    'apiKey',
    'api_key',
    'accessToken',
    'refreshToken'
])

export function summarizeAuthorization(header) {

    if (!header) {

        return { present: false }
    }

    const parts = String(header).split(' ')
    const scheme = parts[0] || 'unknown'
    const token = parts.slice(1).join(' ')

    if (!token) {

        return {
            scheme,
            present: true,
            len: String(header).length
        }
    }

    return {
        scheme,
        present: true,
        len: token.length
    }
}

function redactValue(value) {

    if (Array.isArray(value)) {

        return value.map(redactValue)
    }

    if (!value || typeof value !== 'object') {

        return value
    }

    const out = {}

    for (const [key, v] of Object.entries(value)) {

        out[key] = REDACT_KEYS.has(key) ? '[REDACTED]' : redactValue(v)
    }

    return out
}

export function truncateReqBody(body) {

    if (body == null) {

        return undefined
    }

    if (Buffer.isBuffer(body)) {

        return undefined
    }

    let str

    if (typeof body === 'string') {

        str = body
    } else {

        try {

            str = JSON.stringify(redactValue(body))
        } catch {

            return undefined
        }
    }

    if (/^\s*</.test(str)) {

        return undefined
    }

    if (str.length <= BODY_MAX) {

        return str
    }

    return `${str.slice(0, BODY_MAX)}…truncated,totalChars=${str.length}`
}

function shouldLogReqBody(status) {

    const flag = String(process.env.HTTP_LOG_REQ_BODY || '').toLowerCase()

    if (flag === '1' || flag === 'true' || flag === 'yes') {

        return true
    }

    return status >= 400
}

function pickRid(req) {

    return req.headers['x-request-id']
        || String(req.headers['x-cloud-trace-context'] || '').split('/')[0]
        || undefined
}

function buildAccessData(req, res, ms) {

    const status = res.statusCode
    const data = {
        method: req.method,
        path: req.path || req.url,
        rid: pickRid(req),
        route: req.route && req.route.path ? req.route.path : undefined,
        params: req.params && Object.keys(req.params).length ? req.params : undefined,
        query: req.query && Object.keys(req.query).length ? req.query : undefined,
        status,
        ms,
        xForwardedFor: req.headers['x-forwarded-for'],
        userAgent: req.headers['user-agent'],
        authorization: summarizeAuthorization(req.headers.authorization)
    }

    const reqLen = req.headers['content-length']
    const resLen = res.getHeader('content-length')

    if (reqLen != null) {

        data.reqBytes = Number(reqLen) || reqLen
    }

    if (resLen != null) {

        data.resBytes = Number(resLen) || resLen
    }

    if (shouldLogReqBody(status)) {

        const reqBody = truncateReqBody(req.body)

        if (reqBody != null) {

            data.reqBody = reqBody
        }
    }

    return data
}

export default function httpAccessLog(req, res, next) {

    const started = Date.now()

    res.on('finish', () => {

        const ms = Date.now() - started
        const data = buildAccessData(req, res, ms)
        const payload = {
            eventName: 'HTTP_REQUEST',
            data
        }

        if (data.status >= 500) {

            logger.error('http request', payload)
            return
        }

        logger.info('http request', payload)
    })

    next()
}
