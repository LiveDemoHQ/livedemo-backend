import helpers from '../helpers/livedemoHelpers.js'
import livedemoHelpers from '../helpers/livedemoHelpers.js'
import aiHelpers from '../helpers/aiHelpers.js'
import postStoryAIVoiceValidator from '../helpers/validators/stories/postStoryAIVoice.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import AudioTypes from '../constants/AudioTypes.js'
import StepViewTypes from '../constants/StepViewTypes.js'

// const ENV = require('../envServer')
import ENV from '../envServer.js'
import mongoose from 'mongoose';
const { ObjectId } = mongoose.Types;
import short from 'short-uuid'

import * as parse5 from 'parse5'

import logger from '../helpers/logger.js'

const {STORY_REQUESTS_FOLDER} = ENV

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

const handler = function (req, res) {
    let {Models, conn} = req.mongo

    let requestBody = null

    let workspaceId = req.params.workspaceId
    let storyId = req.params.storyId
    let authUserDoc = null

    let voiceId = ''

    return Promise.resolve().then(async () => {

        return helpers.authReq(req, Models)
    })
        .then(({authUser}) => {
            authUserDoc = authUser

            let validatedBody = helpers.validateBody(req.body, postStoryAIVoiceValidator)
            requestBody = validatedBody.value

            helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
        })
        .then(() => {
            voiceId = requestBody.voiceId


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
                            model: 'Audio',
                        }
                    ],
                    select: '_id name type steps customTransitions imageUrl index imageUrl asset zoomSpans startTime endTime playbackRate',
                    options: {sort: {'index': 1}}
                })
                .populate('workspaceId', '_id name')
        })
        .then((storyDoc) => {

            let steps = storyDoc.screens.reduce((accum, screen) => {
                screen.steps.forEach(step => {
                    step.screenId = screen._id

                    accum.push(step)
                })

                return accum
            }, [])

            let filteredSteps = steps.map(step => {
                // Popups have no view.content — their spoken text is the popup title.
                let source = (step.view && step.view.viewType === StepViewTypes.POPUP)
                    ? (step.view.popup && step.view.popup.title)
                    : step.view.content

                let text = deserializeToTextRecursive(parse5.parseFragment(source || ''), '')

                if (text) {
                    return {
                        step: step,
                        text: text
                    }
                } else {
                    return false
                }
            })
                .filter(step => !!step)


            let promiseCreators = filteredSteps
                .map(({step, text}) => {
                    return () => {

                        let audioFileName = short.uuid()

                        let timestampData = {
                            alignment: {},
                            normalizedAlignment: {}
                        }

                        // Generate mp3 for the step text
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
                                // Create StepAudio document for each mp3 voice and delete old one
                                let chainPromise = Promise.resolve()
                                if (step.stepAudioId) {

                                    chainPromise = chainPromise.then(() => {
                                        return Models.StepAudio.findOneAndUpdate({_id: step.stepAudioId}, {
                                            $set: {active: false}
                                        })
                                    })
                                }

                                return chainPromise.then(() => new Models.Audio({
                                        audioUrl: `${ENV.LIVEDEMO_CDN_URL}/step-audios/${audioFileName}.mp3`,
                                        text: text,
                                        audioType: AudioTypes.ai,
                                        voiceType: voiceId,
                                        workspaceId: workspaceId,
                                        timestamp: {
                                            alignment: timestampData.alignment,
                                            normalizedAlignment: timestampData.normalizedAlignment
                                        },
                                        active: true
                                    }).save()
                                )
                            })
                            .then(stepAudioDoc => {

                                return {
                                    step: step,
                                    stepAudioId: stepAudioDoc._id
                                }
                            })
                    }
                })

            return livedemoHelpers.executePromisesInBatches(promiseCreators, 2)
        })
        .then((stepsWithAudio) => {
            // Update each step with it's new mp3 voice
            let updateOps = []
            stepsWithAudio.forEach((resultObj) => {

                if (resultObj.stepAudioId) {

                    updateOps.push({
                        updateOne: {
                            filter: {
                                _id: new ObjectId(resultObj.step.screenId),
                                "steps": {$elemMatch: {_id: new ObjectId(resultObj.step._id)}}
                            },
                            update: {
                                $set: {
                                    "steps.$.stepAudioId": resultObj.stepAudioId
                                }
                            }
                        }
                    })
                }
            })


            return Models.Screen.bulkWrite(updateOps)
        })
        .then(result => {
            logger.info(result, { eventName: 'POST_STORY_AIVOICE' })
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
                body: JSON.stringify({
                    success: true
                })
            }

            res.set(resultResponse.headers)
            res.status(resultResponse.statusCode)
            res.send(resultResponse.body)
        })
        .catch((error) => {
            logger.error(error, { eventName: 'POST_STORY_AIVOICE_FAILED' })

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
