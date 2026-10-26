import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import mongoose from 'mongoose';
import logger from '../helpers/logger.js'

const { ObjectId } = mongoose.Types;

const handler = async function (req, res) {
    let {Models, conn} = req.mongo


    let workspaceId = req.params.workspaceId
    let storyId = req.params.storyId
    let screenId = req.params.screenId
    let stepId = req.params.stepId
    let authUserDoc = null

    return Promise.resolve().then(async () => {

        return helpers.authReq(req, Models)
    })
        .then(({authUser, authToken}) => {
            authUserDoc = authUser

            helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
        })
        .then(() => {

            // return new Models.Audio({
            //     audioUrl: `${ENV.LIVEDEMO_CDN_URL}/step-audios/${audioFileName}.mp3`,
            //     text: text,
            //     audioType: AudioTypes.ai,
            //     voiceType: voiceId,
            //     workspaceId: workspaceId,
            //     timestamp: {
            //         alignment: timestampData.alignment,
            //         normalizedAlignment: timestampData.normalizedAlignment
            //     },
            //     active: true
            // }, {new: true})
            //     .save()


            return new Models.Audio({
                workspaceId: workspaceId,
                active: true
            }).save()
                .then((audioDoc) => {

                    return Models.Screen.findOneAndUpdate({
                        _id: screenId,
                        'steps._id': new ObjectId(stepId)
                    }, {
                        $set: {
                            ['steps.$.stepAudioId']: audioDoc._id
                        }
                    }, {new: true})
                        .then((screenDoc) => {
                            return audioDoc
                        })
                })
        })
        .then((audioDoc) => {
            if (!audioDoc) {
                throw new Error('Audio could not be created')
            }

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
            logger.error(error, { eventName: 'POST_STEP_AUDIO_FAILED' })

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
