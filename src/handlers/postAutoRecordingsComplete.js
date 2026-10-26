import ResponseCodes from '../constants/ResponseCodes.js'
import AutoRecordingStatuses from '../constants/AutoRecordingStatuses.js'
import liveDemoHelpers from '../helpers/livedemoHelpers.js'
import flixHelpers from "../helpers/flixHelpers.js";

import logger from '../helpers/logger.js'

function getAutoRecordingById(Models, autoRecordingId) {
    return Models.AutoRecording({_id: autoRecordingId}).lean()
}

const handler = function (req, res) {
    let {Models, conn} = req.mongo


    let workspaceId = req.params.workspaceId
    let autoRecordingId = req.params.autoRecordingId
    let requestBody = null
    let authUserDoc = null

    return Promise.resolve()
        // .then(async () => {

        // return helpers.authReq(req, Models)
        // })
        .then(() => {
            // authUserDoc = authUser

            // helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
        })
        .then(() => {
            return Models.AutoRecording.findOne({_id: autoRecordingId}).lean()
        })
        .then(async (autoRecordingDoc) => {
            if (!autoRecordingDoc) {
                throw new Error('AutoRecording not found')
            }

            return Models.AutoRecording.findOneAndUpdate({_id: autoRecordingId}, {
                    $set: {
                        status: AutoRecordingStatuses['recording-finished']
                    }
                },
                {
                    new: true
                })
            //
            // while(autoRecordingDoc.status === AutoRecordingStatuses.recording) {
            //
            // }
        })

        // .then((autoRecordingDoc) => {
        //
        //     return flixHelpers.enqueueProcessAutoRecording(autoRecordingDoc._id)
        //         .then(() => {
        //
        //             return autoRecordingDoc
        //         })
        // })
        // .then(async (autoRecordingDoc) => {
        //
        //     let retryCount = 0
        //
        //     while (autoRecordingDoc.status !== AutoRecordingStatuses.completed && retryCount < 15) {
        //         autoRecordingDoc = await Models.AutoRecording.findOne({_id: autoRecordingId}).lean()
        //         retryCount++
        //         await liveDemoHelpers.sleep(3000)
        //     }
        //
        //     return Models.AutoRecording.findOne({_id: autoRecordingId})
        //         .populate('demoSuggestions')
        //         .lean()
        // })
        .then((autoRecordingDoc) => {
            if (!autoRecordingDoc) {
                throw new Error('AutoRecording not found')
            }

            return autoRecordingDoc
        })
        .then((autoRecordingDoc) => {

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
            res.send(JSON.stringify(autoRecordingDoc))
        })
        .catch((error) => {
            logger.error(error, { eventName: 'POST_AUTO_RECORDINGS_COMPLETE_FAILED' })

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
