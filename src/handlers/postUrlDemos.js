import ResponseCodes from '../constants/ResponseCodes.js'
import ENV from '../envServer.js'
import monq from 'monq'
import LambdaRateLimiter from 'lambda-rate-limiter'
import helpers from '../helpers/livedemoHelpers.js'
import postUrlDemosValidator from '../helpers/validators/urlDemos/postUrlDemosValidator.js'
import { cloneUrlDemoWithStoryForUser } from '../helpers/cloneUrlDemoStoriesForUser.js'
import mongoose from 'mongoose';

import logger from '../helpers/logger.js'

const { ObjectId } = mongoose.Types;

const CORS_HEADERS = {
    'Access-Control-Max-Age': 600,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
    'Access-Control-Allow-Credentials': true,
}

// 3 requests per minute per IP
const ipLimiter = LambdaRateLimiter({
    interval: 60000,
    uniqueTokenPerInterval: 2000,
})

function enqueueProcessUrlDemo(urlDemoId, userId, shouldCreateStandard) {
    const client = monq(ENV.DB_URI || 'mongodb://localhost:27017/livedemo_app')
    const queue = client.queue('urlDemos', { collection: 'jobs-monq' })

    const jobData = { urlDemoId }
    if (userId) {
        jobData.userId = userId
    }
    if (shouldCreateStandard) {
        jobData.shouldCreateStandard = shouldCreateStandard
    }

    return new Promise((resolve, reject) => {
        queue.enqueue('processUrlDemo', jobData, function (err, job) {
            if (err) {
                return reject(err)
            }
            logger.info('Enqueued processUrlDemo:', { eventName: 'ENQUEUED_PROCESSURLDEMO', data: { detail: job.data } })
            resolve()
        })
    })
}

async function tryGetAuthUser(req, Models) {
    try {
        const { authUser } = await helpers.authReq(req, Models)
        return authUser || null
    } catch {
        return null
    }
}

const handler = function (req, res) {
    const { Models } = req.mongo

    const clientIp =
        (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
        req.socket?.remoteAddress ||
        'unknown'

    logger.info('[postUrlDemos] Requesting with clientIp: ' + clientIp, { eventName: 'POST_URL_DEMOS' })

    return Promise.resolve()
        .then(() => {
            return ipLimiter.check(3, clientIp)
        })
        .catch(() => {
            res.set(CORS_HEADERS)
            res.status(ResponseCodes['429_TOO_MANY_REQUESTS'])
            res.send(JSON.stringify({ error: 'Too many requests' }))
            throw Object.assign(new Error('rate-limited'), { handled: true })
        })
        .then(() => tryGetAuthUser(req, Models))
        .then((userDoc) => {
            const validated = helpers.validateBody(req.body, postUrlDemosValidator)
            return { url: validated.value.url, userDoc, userId: userDoc?._id?.toString() || null }
        })
        .then(({ url, userDoc, userId }) => {

            const { browserSessionId } = req.body

            return Models.UrlDemo.findOne({ url, type: 'standard' })
                .lean()
                .then((standardUrlDemoDoc) => {

                    if (standardUrlDemoDoc && browserSessionId && !userId) {
                        return new Models.UrlDemo({
                            ...standardUrlDemoDoc,
                            _id: new ObjectId(),
                            type: 'browsed',
                            browserSessionId: browserSessionId || ''
                        })
                            .save()
                            .then((urlDemoDoc) => {
                                return urlDemoDoc
                            })
                    } else if (standardUrlDemoDoc && !browserSessionId && !userId) {

                        return standardUrlDemoDoc
                    } else if (standardUrlDemoDoc && userId) {

                        return Models.UrlDemo.findOne({ url, type: 'owned', userId })
                            .then((foundUrlDemoDoc) => {
                                if (foundUrlDemoDoc) {
                                    return foundUrlDemoDoc
                                } else {

                                    const firstWorkspace = userDoc?.workspaces?.[0]
                                    const workspaceId = firstWorkspace?._id || firstWorkspace
                                    if (!workspaceId) {
                                        throw new Error('No workspace found for user')
                                    }

                                    return cloneUrlDemoWithStoryForUser(standardUrlDemoDoc, userId, workspaceId, browserSessionId || '', Models)
                                }
                            })

                    } else if (!standardUrlDemoDoc) {
                        const type = !!userId ? 'owned' : 'browsed'
                        const shouldCreateStandard = type === 'owned'

                        return new Models.UrlDemo({ url, type, browserSessionId: browserSessionId || '' })
                            .save()
                            .then((urlDemoDoc) => {

                                return enqueueProcessUrlDemo(urlDemoDoc._id.toString(), userId, shouldCreateStandard)
                                    .catch((err) => {
                                        logger.error('Failed to enqueue processUrlDemo:', { eventName: 'FAILED_TO_ENQUEUE_PROCESSURLDEMO_FAILED', err: err })
                                    })
                                    .then(() => urlDemoDoc)
                            })

                    }

                })
        })
        .then((urlDemoDoc) => {
            res.set(CORS_HEADERS)
            res.status(ResponseCodes['200_OK'])
            res.send(JSON.stringify(urlDemoDoc))
        })
        .catch((error) => {
            if (error.handled) return

            logger.error('[postUrlDemos]', { eventName: 'POST_URL_DEMOS_FAILED', err: error })

            res.set(CORS_HEADERS)
            res.status(ResponseCodes['500_INTERNAL_SERVER_ERROR'])
            res.send(JSON.stringify({ error: 'Internal server error' }))
        })
}
export default handler
