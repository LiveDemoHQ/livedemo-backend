import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import mongoose from 'mongoose'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
    let { Models, conn } = req.mongo

    let workspaceId = req.params.workspaceId
    let authUserDoc = null

    return Promise.resolve().then(async () => {

        return helpers.authReq(req, Models)
    })
        .then(({ authUser }) => {
            authUserDoc = authUser

            helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
        })
        .then(async () => {

            return Models.AutoRecording.aggregate([
                { $match: { workspaceId: new mongoose.Types.ObjectId(workspaceId) } },
                {
                    $lookup: {
                        from: 'demosuggestions',
                        let: { firstId: { $arrayElemAt: ['$demoSuggestions', 0] } },
                        pipeline: [
                            { $match: { $expr: { $eq: ['$_id', '$$firstId'] } } },
                            { $project: { _id: 1, name: 1, thumbnailImageData: 1 } }
                        ],
                        as: 'firstDemoSuggestion'
                    }
                },
                {
                    $addFields: {
                        firstDemoSuggestion: { $arrayElemAt: ['$firstDemoSuggestion', 0] }
                    }
                }
            ])
        })
        .then((foundAutoRecordings) => {

            const resultResponse = {
                statusCode: ResponseCodes['200_OK'],
                headers: {
                    'Access-Control-Max-Age': 600,
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
                    'Access-Control-Allow-Credentials': true,
                }
            }

            res.set(resultResponse.headers)
            res.status(resultResponse.statusCode)
            res.send(JSON.stringify(foundAutoRecordings))
        })
        .catch((error) => {
            logger.error(error, { eventName: 'GET_AUTO_RECORDINGS_FAILED' })

            let resultResponse
            if (error.resultResponse) {

                resultResponse = error.resultResponse
            } else {

                resultResponse = {
                    statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
                    headers: {
                        'Access-Control-Max-Age': 600,
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
                        'Access-Control-Allow-Credentials': true,
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
