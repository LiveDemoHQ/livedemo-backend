import helpers from '../helpers/livedemoHelpers.js'
import patchZoomSpanValidator from '../helpers/validators/stories/screens/zoomSpans/patchZoomSpanValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import ScreenTypes from "../constants/ScreenTypes.js";

import logger from '../helpers/logger.js'

const handler = function (req, res) {
    let {Models, conn} = req.mongo


    let requestBody = null

    let workspaceId = req.params.workspaceId
    // let storyId = req.params.storyId
    // let screenId = req.params.screenId
    // let stepId = req.params.stepId
    let screenId = req.params.screenId
    let zoomSpanId = req.params.zoomSpanId
    let authUserDoc = null

    return Promise.resolve().then(async () => {

        return helpers.authReq(req, Models)
    })
        .then(({authUser}) => {
            authUserDoc = authUser

            let validatedBody = helpers.validateBody(req.body, patchZoomSpanValidator)
            requestBody = validatedBody.value

            helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
        })
        .then(() => {
            const {startTime, duration, width, height, editorWidth, editorHeight, offsetX, offsetY} = requestBody


            let updateObj = {}
            if (startTime || startTime === 0) {
                updateObj['zoomSpans.$.startTime'] = startTime
            }

            if (duration || duration === 0) {
                updateObj['zoomSpans.$.duration'] = duration
            }

            if (width) {
                updateObj['zoomSpans.$.width'] = width
            }

            if (height) {
                updateObj['zoomSpans.$.height'] = height
            }

            if (editorWidth) {
                updateObj['zoomSpans.$.editorWidth'] = editorWidth
            }

            if (editorHeight) {
                updateObj['zoomSpans.$.editorHeight'] = editorHeight
            }

            if (offsetX || offsetX === 0) {
                updateObj['zoomSpans.$.offsetX'] = offsetX
            }

            if (offsetY || offsetX === 0) {
                updateObj['zoomSpans.$.offsetY'] = offsetY
            }

            return updateObj
        })
        .then((updateObj) => {
            return Models.Screen.findById(screenId)
                .then((screenDoc) => {
                    return {updateObj, screenDoc}
                })
        })
        .then(({updateObj, screenDoc}) => {

            if (Object.keys(updateObj).length !== 0) {

                if(screenDoc.type === ScreenTypes.SCREEN_VIDEO) {

                    return Models.Screen_Video.findOneAndUpdate({
                        _id: screenId,
                        'zoomSpans._id': zoomSpanId
                    }, {$set: updateObj}, {
                        new: true,
                        overwrite: false
                    })
                        .then((newScreenDoc) => {

                            return Models.Screen_Video.findOne({_id: screenId, 'zoomSpans._id': zoomSpanId})
                                .lean()
                                .then((screenDoc) => {
                                    return screenDoc.zoomSpans.find(span => span._id.toString() === zoomSpanId)
                                })
                        })
                } else {
                    Object.keys(updateObj).forEach((key) => {
                        let keySplit = key.split('.')
                        let newKey = 'zoomSpan.' + keySplit[keySplit.length - 1]
                        updateObj[newKey] = updateObj[key]
                        delete updateObj[key]
                    })
                    logger.info(updateObj, { eventName: 'PATCH_ZOOM_SPAN' })
                    return Models.Screen_Screenshot.findOneAndUpdate({
                        _id: screenId,
                    }, {$set: updateObj}, {
                        new: true,
                        overwrite: false
                    })
                        .then((newScreenDoc) => {

                            return Models.Screen_Screenshot.findOne({_id: screenId})
                                .lean()
                                .then((screenDoc) => {
                                    return screenDoc.zoomSpan
                                })
                        })
                }


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
            logger.error(error, { eventName: 'PATCH_ZOOM_SPAN_FAILED' })

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
