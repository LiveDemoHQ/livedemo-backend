import winston from 'winston'
import ENV from '../envServer.js'

const { combine, timestamp, errors, printf } = winston.format

const formatMessage = printf((info) => {

    const {
        level,
        message,
        timestamp,
        stack,
        eventName,
        data,
        onOneLine = false,
        ...meta
    } = info

    const base = {
        level,
        eventName: eventName || 'UNKNOWN',
        ts: timestamp,
        message,
        ...(data ? { data } : {}),
        ...meta
    }

    if (level === 'error') {

        // Always include a stack: Error arg / meta.stack, else call-site from wrap below
        base.stack = stack || new Error().stack
    }

    // onOneLine: true → compact single-line JSON; default false → pretty-printed
    return onOneLine ? JSON.stringify(base) : JSON.stringify(base, null, 2)
})

const winstonLogger = winston.createLogger({
    level: 'info',
    levels: { error: 0, info: 1 },
    format: combine(
        errors({ stack: true }),
        timestamp(),
        formatMessage
    ),
    transports: [
        new winston.transports.Console({
            stderrLevels: ['error']
        })
    ],
    defaultMeta: {
        service: 'livedemo-backend',
        env: ENV.ENV
    }
})

// Error message/stack are non-enumerable, so JSON.stringify(err) is {}.
function serializeError(err) {

    const status = err.status ?? err.statusCode ?? err.response?.status
    const fields = {
        name: err.name,
        message: err.message
    }

    if (err.code != null) {

        fields.code = err.code
    }

    if (status != null) {

        fields.status = status
    }

    return fields
}

function withCallSiteStack(meta) {

    const callSiteStack = new Error().stack

    if (meta == null || typeof meta !== 'object') {

        return { stack: callSiteStack }
    }

    let errorStack
    const serialized = {}

    for (const [key, value] of Object.entries(meta)) {

        if (value instanceof Error) {

            serialized[key] = serializeError(value)
            errorStack = errorStack || value.stack
        } else {

            serialized[key] = value
        }
    }

    return {
        ...serialized,
        stack: meta.stack || errorStack || callSiteStack
    }
}

const logger = {
    info: (...args) => winstonLogger.info(...args),
    error: (message, meta) => {

        if (message instanceof Error) {

            return winstonLogger.error(message.message, withCallSiteStack({
                ...(meta && typeof meta === 'object' ? meta : {}),
                err: message.message,
                stack: message.stack || undefined
            }))
        }

        return winstonLogger.error(message, withCallSiteStack(meta))
    }
}

export default logger
