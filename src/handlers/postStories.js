import helpers from '../helpers/livedemoHelpers.js'
import flixHelpers from '../helpers/flixHelpers.js'
import postStoriesValidator from '../helpers/validators/stories/postStoriesValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import StoryStatuses from '../constants/StoryStatuses.js'
import demoStepLimit from '../helpers/demoStepLimit.js'
import ENV from '../envServer.js'
// const {STORY_REQUESTS_FOLDER} = ENV
import mongoose from 'mongoose';
const { ObjectId } = mongoose.Types;
import short from 'short-uuid'
import stringify from 'stream-json-stringify'
import he from 'he'


const handler = function (req, res) {
    let {Models, conn} = req.mongo

    let requestBody = req.body
    let authUserDoc = null

    return Promise.resolve().then(async () => {

        return helpers.authReq(req, Models)
    })
        .then(({authUser}) => {
            authUserDoc = authUser
            let validatedBody = helpers.validateBody(req.body, postStoriesValidator)
            requestBody = validatedBody.value

            helpers.validateUserHasAccessToWorkspace(authUserDoc, requestBody.workspaceId)

            const clickCount = (requestBody.capturedEvents || [])
                .filter((event) => event && event.type === 'click')
                .length
            demoStepLimit.assertClickCount(clickCount)
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
                .map(event => {
                    if(event.targetHTML) {
                        event.targetHTML = he.encode(event.targetHTML)
                    }
                    return event
                })
            let videoStartMs = requestBody.videoStartMs
            let videoEndMs = requestBody.videoEndMs
            let aspectRatio = requestBody.aspectRatio
            let tabInfo = requestBody.tabInfo
            let windowMeasures = requestBody.windowMeasures
            let renderEvents = {}
            let videoId = short.uuid()
            let videoAssetId = ''

            let videoUrl = ''
            let screenshots = {}
            let videos = {}

            /*
             return new Models.Story({
              name,
              workspaceId,
              userId: authUserDoc._id
            }).save()
          })
             */


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
                        screens: [],
                        capturedEvents,
                        aspectRatio,
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
            console.log('Story created')

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
            console.log(error)

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
