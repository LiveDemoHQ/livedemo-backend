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

    return JSON.stringify(base, null, 2)
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

function withCallSiteStack(meta) {

    const callSiteStack = new Error().stack

    if (meta == null) {

        return { stack: callSiteStack }
    }

    if (typeof meta !== 'object') {

        return { stack: callSiteStack }
    }

    return {
        ...meta,
        stack: meta.stack || callSiteStack
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
