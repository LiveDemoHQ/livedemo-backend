import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import path from 'path'
import short from 'short-uuid'
import ENV from "../envServer.js";
import AudioTypes from "../constants/AudioTypes.js";
import mongoose from 'mongoose';
import logger from '../helpers/logger.js'

const { ObjectId } = mongoose.Types;


const handler = function (req, res) {
    let {Models, conn} = req.mongo

    let workspaceId = req.params.workspaceId
    let storyId = req.params.storyId
    let screenId = req.params.screenId
    let stepId = req.params.stepId
    let authUserDoc = null
    let audioBuffer = req.file.buffer
    let mimeType = req.file.mimetype
    let originalName = req.file.originalname

    return Promise.resolve().then(async () => {

        return helpers.authReq(req, Models)
    })
        .then(({authUser}) => {
            authUserDoc = authUser

            helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
        })
        .then(async () => {
            let audioUrl = ''
            let audioFileName = short.uuid()
            return helpers.uploadStepAudio(audioBuffer, 'audio/mpeg', `${audioFileName}.mp3`)
                .then((uploadResult) => {
                    logger.info(uploadResult, { eventName: 'POST_STEP_UPLOAD_AUDIO' })
                    audioUrl = `${ENV.LIVEDEMO_CDN_URL}/step-audios/${audioFileName}.mp3`


                    return audioUrl
                })
        })
        .then((audioUrl) => {
            return new Models.Audio({
                audioUrl: audioUrl,
                text: '',
                audioType: AudioTypes.person,
                voiceType: '',
                workspaceId: workspaceId,
                active: true
            }).save()
        })
        .then((audioDoc) => {

            return Models.Screen.findOneAndUpdate({_id: new ObjectId(screenId), 'steps._id': new ObjectId(stepId)}, {
                $set: {
                    "steps.$.stepAudioId": audioDoc._id
                }
            }, {new: true})
        })
        .then((screenDoc) => {

            const resultResponse = {
                statusCode: ResponseCodes['200_OK'],
                headers: {
                    'Access-Control-Max-Age': 600,
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
                    // Required for CORS support to work
                    'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
                }
            }

            res.set(resultResponse.headers)
            res.status(resultResponse.statusCode)
            res.send(JSON.stringify({screenDoc}))
        })
        .catch((error) => {
            logger.error(error, { eventName: 'POST_STEP_UPLOAD_AUDIO_FAILED' })

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
