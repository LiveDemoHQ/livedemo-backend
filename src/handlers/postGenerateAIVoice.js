import helpers from '../helpers/livedemoHelpers.js'
import aiHelpers from '../helpers/aiHelpers.js'
import validator from '../helpers/validators/stories/postGenerateAIVoice.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import short from 'short-uuid'
import ENV from '../envServer.js'

import AudioTypes from '../constants/AudioTypes.js'
import limiter from '../helpers/rateLimiter.js'
import livedemoHelpers from "../helpers/livedemoHelpers.js";


import logger from '../helpers/logger.js'

function deserializeToTextRecursive(parsedFragment, currentString) {
    let value = !!parsedFragment.value ? parsedFragment.value : ''
    if (!parsedFragment.childNodes) {
        currentString += value + '\n'

        return currentString
    }

    parsedFragment.childNodes.forEach(childNode => {
        let value = deserializeToTextRecursive(childNode, '')

        currentString += value
    })

    return currentString
}

const handler = async function (req, res) {
    let {Models, conn} = req.mongo

    let requestBody = null

    let workspaceId = req.params.workspaceId
    let storyId = req.params.storyId
    let authUserDoc = null

    let clientId = req.headers && req.headers.clientid ? req.headers.clientid : 'no-clientid'

    let voiceId = ''
    let text = ''

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
                }, 3
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

            let validatedBody = helpers.validateBody(req.body, validator)
            requestBody = validatedBody.value

            helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
        })
        .then(() => {
            voiceId = requestBody.voiceId
            text = requestBody.text


            return Models.Story.findOne({
                _id: storyId
            })
                .populate({
                    path: 'screens',
                    populate: [
                        {
                            path: 'steps.view.popup.formId',
                            model: 'Form',
                        },
                        {
                            path: 'steps.stepAudioId',
                            model: 'StepAudio',
                        }
                    ],
                    select: '_id name steps type customTransitions imageUrl index imageUrl asset zoomSpans startTime endTime playbackRate',
                    options: {sort: {'index': 1}}
                })
                .populate('workspaceId', '_id name')
        })
        .then(storyDoc => {
            storyDoc = livedemoHelpers.processLiveDemoLinkUpdates(storyDoc, {variables: storyDoc.custom.variables || []})
            return storyDoc
        })
        .then((storyDoc) => {
            if (!storyDoc) {
                throw new Error('Story not found')
            }
            let audioFileName = short.uuid()

            let timestampData = {
                alignment: {},
                normalizedAlignment: {}
            }

            return aiHelpers.elTextToSpeech(voiceId, text)
                .then(({buffer, alignment, normalizedAlignment}) => {
                    timestampData = {
                        alignment,
                        normalizedAlignment
                    }

                    // Save the newly generated mp3 voice in S3
                    return helpers.uploadStepAudio(buffer, 'audio/mpeg', `${audioFileName}.mp3`)
                })
                .then((uploadResult) => {
                    // Create StepAudio document

                    return new Models.Audio({
                        audioUrl: `${ENV.LIVEDEMO_CDN_URL}/step-audios/${audioFileName}.mp3`,
                        text: text,
                        voiceType: voiceId,
                        audioType: AudioTypes.ai,
                        workspaceId: workspaceId,
                        timestamp: {
                            alignment: timestampData.alignment,
                            normalizedAlignment: timestampData.normalizedAlignment
                        },
                        active: false
                    }).save()
                })
        })
        .then((audioDoc) => {

            const resultResponse = {
                statusCode: ResponseCodes['200_OK'],
                headers: {
                    'Access-Control-Max-Age': 600,
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
                    // Required for CORS support to work
                    'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
                },
                body: JSON.stringify(audioDoc)
            }

            res.set(resultResponse.headers)
            res.status(resultResponse.statusCode)
            res.send(resultResponse.body)
        })
        .catch((error) => {
            logger.error(error, { eventName: 'POST_GENERATE_AIVOICE_FAILED' })

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

export default handler
