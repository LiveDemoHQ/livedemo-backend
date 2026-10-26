import helpers from '../helpers/livedemoHelpers.js'
import flixHelpers from '../helpers/flixHelpers.js'
import postDesktopStoriesValidator from '../helpers/validators/stories/postDesktopStoriesValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import StoryStatuses from '../constants/StoryStatuses.js'
import ENV from '../envServer.js'
// const {STORY_REQUESTS_FOLDER} = ENV
import mongoose from 'mongoose';
const { ObjectId } = mongoose.Types;
import short from 'short-uuid'
import stringify from 'stream-json-stringify'
import he from 'he'
import StoryTypes from "../constants/StoryTypes.js";


import logger from '../helpers/logger.js'

const handler = function (req, res) {
    let {Models, conn} = req.mongo

    let requestBody = req.body
    let authUserDoc = null

    return Promise.resolve().then(async () => {

        return helpers.authReq(req, Models)
    })
        .then(({authUser}) => {
            authUserDoc = authUser
            let validatedBody = helpers.validateBody(req.body, postDesktopStoriesValidator)
            requestBody = validatedBody.value

            helpers.validateUserHasAccessToWorkspace(authUserDoc, requestBody.workspaceId)
        })
        .then(() => {
            if (requestBody.storyId) {
                return Models.Story.findOne({_id: requestBody.storyId, status: StoryStatuses.UPLOADING})
                    .then((foundStory) => {
                        if(!foundStory) {
                            throw new Error('Story not found')
                        }

                        return foundStory._id
                    })
            } else {
                return new ObjectId()
            }
        })
        .then(async (storyId) => {

            let name = requestBody.name
            let workspaceId = requestBody.workspaceId

            let capturedEvents = requestBody.capturedEvents

            let videoStartMs = requestBody.videoStartMs
            let videoEndMs = requestBody.videoEndMs
            let tabInfo = requestBody.tabInfo
            let windowMeasures = requestBody.windowMeasures


            const contentStream = stringify(requestBody, {
                highWaterMark: 0.2 * 1000000
            })

            return helpers.writeToSystemFromStream(`${ENV.STORY_REQUESTS_FOLDER}/${storyId}.json`, contentStream, 'utf8')
                .then((filePath) => {
                    return Models.Story.findOneAndUpdate({_id: storyId},{
                        _id: storyId,
                        name,
                        workspaceId,
                        userId: authUserDoc.id,
                        filePath,
                        status: StoryStatuses.UPLOADING,
                        type: StoryTypes.desktop,
                        screens: [],
                        capturedEvents,
                        videoStartMs,
                        videoEndMs,
                        tabInfo,
                        windowMeasures
                    }, {upsert: true, new: true})
                })
                .then((newStoryDoc) => {

                    return flixHelpers.enqueueProcessStoryDemo(newStoryDoc._id.toString(16))
                        .then(() => {

                            return newStoryDoc
                        })
                })
        })
        .then((newStory) => {
            logger.info('Story created', { eventName: 'STORY_CREATED' })

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
            res.send(JSON.stringify({
                _id: newStory._id
            }))
        })
        .catch((error) => {
            logger.error(error, { eventName: 'POST_DESKTOP_STORIES_FAILED' })

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
