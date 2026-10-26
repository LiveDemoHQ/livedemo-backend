import helpers, {default as livedemoHelpers} from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import * as sanitezeLib from '@braintree/sanitize-url'

import logger from '../helpers/logger.js'

const sanitize = sanitezeLib.sanitizeUrl

const handler = function (req, res) {
    let {Models, conn} = req.mongo

    let storyId = req.params.storyId
    let link = req.query.link ? sanitize(req.query.link) : ""

    let authUserDoc = null

    return Promise.resolve()
        .then(() => {
            return Models.Story.findOne({
                _id: storyId,
                deletedAt: null
            })
                .populate({
                    path: 'screens',
                    populate: [
                        {
                            path: 'customTransitions.gotoScreen',
                            model: 'Screen',
                            select: '_id name'
                        },
                        {
                            path: 'steps.view.popup.formId',
                            model: 'Form',
                        },
                        {
                            path: 'steps.stepAudioId',
                            model: 'Audio',
                        }
                    ],
                    select: '_id name steps customTransitions imageUrl type index asset zoomSpans startTime endTime playbackRate',
                    options: {sort: {'index': 1}}
                })
                .populate('workspaceId', '_id name')
                .then((storyDoc) => {

                    return {
                        foundStory: storyDoc,
                    }
                })
        })
        .then(({foundStory}) => {

            if (foundStory.isPublished) {

                return Promise.resolve(foundStory)
            } else {

                return helpers.authReq(req, Models)
                    .then(({authUser}) => {
                        authUserDoc = authUser

                        if (helpers.validateUserHasAccessToWorkspace(authUserDoc, foundStory.workspaceId._id.toString(16))) {

                            return foundStory
                        }
                    })
            }

        })
        .then((foundStory) => {
            if (link) {
                return Models.Link.findOne({_id: link}).lean()
                    .then(linkDoc => {
                        if (!linkDoc || !linkDoc.variables) {
                            throw new Error('Cannot find link')
                        }

                        foundStory = livedemoHelpers.processLiveDemoLinkUpdates(foundStory, linkDoc)

                        return foundStory
                    })
            } else {
                foundStory = livedemoHelpers.processLiveDemoLinkUpdates(foundStory, {variables: foundStory.custom.variables || []})

                return foundStory
            }

        })
        .then((foundStory) => {

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
            res.send(JSON.stringify(foundStory))
        })
        .catch((error) => {
            logger.error(error, { eventName: 'GET_PREVIEW_STORY_FAILED' })

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

