import helpers from '../helpers/livedemoHelpers.js'
import aiHelpers from '../helpers/aiHelpers.js'
import validator from '../helpers/validators/stories/postGenerateAIVoice.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import VoiceTypes from '../constants/VoiceTypes.js'
import short from 'short-uuid'
import ENV from '../envServer.js'
import mongoose from 'mongoose';
import logger from '../helpers/logger.js'

const { ObjectId } = mongoose.Types;

const handler = async function (req, res) {
    let {Models, conn} = req.mongo


    let workspaceId = req.params.workspaceId
    let storyId = req.params.storyId
    let screenId = req.params.screenId
    let stepId = req.params.stepId
    let audioId = req.params.audioId
    let authUserDoc = null

    return Promise.resolve().then(async () => {

        return helpers.authReq(req, Models)
    })
        .then(({authUser, authToken}) => {
            authUserDoc = authUser

            helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
        })
        .then(() => {


            return Models.Screen.findOneAndUpdate({
                _id: screenId,
                'steps._id': new ObjectId(stepId)
            }, {
                $set: {
                    ['steps.$.stepAudioId']: null
                }
            }, {new: true})

        })
        .then((screenDoc) => {
            if (!screenDoc) {
                throw new Error('Screen not found')
            }

            // TODO: Have to later clear the deleted Audio files and docs
            return Models.Audio.findOneAndUpdate({
                _id: audioId
            }, {
                $set: {
                    deletedAt: new Date()
                }
            }, {
                new: true
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
            logger.error(error, { eventName: 'DELETE_STEP_AUDIO_FAILED' })

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
