import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
    let {Models, conn} = req.mongo

    let workspaceId = req.params.workspaceId
    let storyId = req.params.storyId
    let authUserDoc = null

    return Promise.resolve().then(async () => {

        return helpers.authReq(req, Models)
    })
        .then(({authUser}) => {
            authUserDoc = authUser

            helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
        })
        .then(async () => {


            return Models.Story.findOneAndUpdate({
                _id: storyId
            }, {
                $set: {
                    deletedAt: new Date()
                }
            }, {
                new: true
            })
        })
        .then((deletedStory) => {

            return Models.ChecklistProgress.deleteMany({ hostStoryId: storyId, workspaceId }).then(() => deletedStory)
        })
        .then((deletedStory) => {

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
            res.send(JSON.stringify(deletedStory))
        })
        .catch((error) => {
            logger.error(error, { eventName: 'DELETE_STORY_FAILED' })

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

