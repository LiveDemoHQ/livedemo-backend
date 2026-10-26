import helpers from '../helpers/livedemoHelpers.js'
import flixHelpers from '../helpers/flixHelpers.js'
import aiHelpers from '../helpers/aiHelpers.js'
import validator from '../helpers/validators/stories/postGenerateAIVoice.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import ContentStatuses from '../constants/ContentStatuses.js'
import VoiceTypes from '../constants/VoiceTypes.js'
import short from 'short-uuid'
import ENV from '../envServer.js'

import AudioTypes from '../constants/AudioTypes.js'
import limiter from '../helpers/rateLimiter.js'


import logger from '../helpers/logger.js'

const handler = async function (req, res) {
    let {Models, conn} = req.mongo

    let requestBody = null

    let workspaceId = req.params.workspaceId
    let storyId = req.params.storyId
    let authUserDoc = null

    let clientId = req.headers && req.headers.clientid ? req.headers.clientid : 'no-clientid'

    return Promise.resolve().then(async () => {

        return helpers.authReq(req, Models)
    })
        .then(({authUser, authToken}) => {

            return limiter(
                clientId,
                authToken,
                (errorResponse) => {
                    let failedRateLimitError = new Error('')
                    failedRateLimitError.resultResponse = errorResponse

                    throw failedRateLimitError
                }, 1
            )
                .then(() => {
                    return {
                        authUser,
                        authToken
                    }
                })
        })
        .then(({authUser, authToken}) => {
            authUserDoc = authUser

            helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
        })
        .then(() => {


            return Models.Story.findOneAndUpdate({
                _id: storyId
            }, {
                $set: {
                    content: {
                        contentStatus: ContentStatuses.UPDATING
                    }
                }
            })
        })
        .then(() => {
            return flixHelpers.enqueueProcessStoryDemoVideo(storyId, authUserDoc.email)
        })
        .then(() => {

            const resultResponse = {
                statusCode: ResponseCodes['200_OK'],
                headers: {
                    'Access-Control-Max-Age': 600,
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
                    // Required for CORS support to work
                    'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
                },
                body: JSON.stringify({})
            }

            res.set(resultResponse.headers)
            res.status(resultResponse.statusCode)
            res.send(resultResponse.body)
        })
        .catch((error) => {
            logger.error(error, { eventName: 'POST_GENERATE_STORY_CONTENT_FAILED' })

            let resultResponse
            if (error.resultResponse) {

                resultResponse = error.resultResponse
            } else {


                resultResponse = {
                    statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
                    headers: {
                        'Access-Control-Max-Age': 600,
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
                        // Required for CORS support to work
                        'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
                    },
                    body: ''
                }

            }

            res.set(resultResponse.headers)
            res.status(resultResponse.statusCode)
            res.send(resultResponse.body)
        })
}

export default  handler
