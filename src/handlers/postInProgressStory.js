import helpers from '../helpers/livedemoHelpers.js'
import postStoriesValidator from '../helpers/validators/stories/postInProgressStoryValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import StoryStatuses from '../constants/StoryStatuses.js'
// const {STORY_REQUESTS_FOLDER} = ENV
import mongoose from 'mongoose';
import { httpError } from '../helpers/agent/http.js'
const { ObjectId } = mongoose.Types;

// "Add flow to…" must target a sandbox of the same workspace
async function assertSandboxCapture(Models, body) {
    if (body.targetSandboxId) {

        const target = await Models.Story.exists({ _id: body.targetSandboxId, workspaceId: body.workspaceId, mode: 'sandbox', deletedAt: null })
        if (!target) httpError(ResponseCodes['400_BAD_REQUEST'], 'targetSandboxId must be a sandbox in this workspace')
    }
}


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
        }).then(async () => {

            if (requestBody.mode === 'sandbox') {

                await assertSandboxCapture(Models, requestBody)
            }
        }).then(() => {

            const storyFields = {
                name: requestBody.name,
                workspaceId: requestBody.workspaceId,
                userId: authUserDoc.id,
                status: StoryStatuses.UPLOADING,
                screens: [],
            }
            if (requestBody.recordingType) {
                storyFields.recordingType = requestBody.recordingType
            }
            if (requestBody.rrweb) {
                storyFields.rrweb = requestBody.rrweb
            }
            if (requestBody.tabInfo) {
                storyFields.tabInfo = requestBody.tabInfo
            } else if (requestBody.rrweb && requestBody.rrweb.viewport) {
                storyFields.tabInfo = {
                    width: requestBody.rrweb.viewport.width,
                    height: requestBody.rrweb.viewport.height,
                }
            }
            if (requestBody.mode === 'sandbox') {

                storyFields.mode = 'sandbox'
                if (requestBody.targetSandboxId || requestBody.flowName) {

                    storyFields.sandboxCapture = { targetSandboxId: requestBody.targetSandboxId || null, flowName: requestBody.flowName || '' }
                }
            }
            if (requestBody.windowMeasures) {
                storyFields.windowMeasures = requestBody.windowMeasures
            } else if (requestBody.rrweb && requestBody.rrweb.viewport) {
                storyFields.windowMeasures = {
                    innerWidth: requestBody.rrweb.viewport.width,
                    innerHeight: requestBody.rrweb.viewport.height,
                }
            }
            return new Models.Story(storyFields).save()
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
