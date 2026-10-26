import helpers from '../helpers/livedemoHelpers.js'
import patchStepZoomSpanValidator
    from '../helpers/validators/stories/screens/steps/zoomSpans/patchStepZoomSpanValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import mongoose from 'mongoose';
import logger from '../helpers/logger.js'

const { ObjectId } = mongoose.Types;

const handler = function (req, res) {
    let {Models, conn} = req.mongo


    let requestBody = null

    let workspaceId = req.params.workspaceId
    // let storyId = req.params.storyId
    // let screenId = req.params.screenId
    // let stepId = req.params.stepId
    let screenId = req.params.screenId
    let stepId = req.params.stepId
    let zoomSpanId = req.params.zoomSpanId
    let authUserDoc = null

    return Promise.resolve().then(async () => {

        return helpers.authReq(req, Models)
    })
        .then(({authUser}) => {
            authUserDoc = authUser

            let validatedBody = helpers.validateBody(req.body, patchStepZoomSpanValidator)
            requestBody = validatedBody.value

            helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
        })
        .then(() => {
            const {delay, duration, width, height, editorWidth, editorHeight, offsetX, offsetY} = requestBody


            let updateObj = {}
            if (delay || delay === 0) {
                updateObj['steps.$.zoomSpan.delay'] = delay
            }

            if (duration || duration === 0) {
                updateObj['steps.$.zoomSpan.duration'] = duration
            }

            if (width) {
                updateObj['steps.$.zoomSpan.width'] = width
            }

            if (height) {
                updateObj['steps.$.zoomSpan.height'] = height
            }

            if (editorWidth) {
                updateObj['steps.$.zoomSpan.editorWidth'] = editorWidth
            }

            if (editorHeight) {
                updateObj['steps.$.zoomSpan.editorHeight'] = editorHeight
            }

            if (offsetX || offsetX === 0) {
                updateObj['steps.$.zoomSpan.offsetX'] = offsetX
            }

            if (offsetY || offsetY === 0) {
                updateObj['steps.$.zoomSpan.offsetY'] = offsetY
            }

            return updateObj
        })
        .then((updateObj) => {

            if (Object.keys(updateObj).length !== 0) {

                // Base Screen model: steps/zoomSpan live on the base schema, so this
                // works for any discriminator (Screenshot, Page) without a type filter.
                return Models.Screen.findOneAndUpdate({
                    _id: new ObjectId(screenId),
                    'steps._id': new ObjectId(stepId)
                }, {
                    $set: updateObj
                }, {new: true, overwrite: false})
                    .then((screen) => {
                        return screen.steps.find(step => step._id.toString() === stepId).zoomSpan
                    })
            } else {

                return null
            }
        })
        .then((newZoomSpanDoc) => {

            if (!newZoomSpanDoc) {
                throw new Error('ZoomSpan couldn\'t be updated')
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
                body: JSON.stringify(newZoomSpanDoc)
            }

            res.set(resultResponse.headers)
            res.status(resultResponse.statusCode)
            res.send(resultResponse.body)

        })
        .catch((error) => {
            logger.error(error, { eventName: 'PATCH_STEP_ZOOM_SPAN_FAILED' })

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
