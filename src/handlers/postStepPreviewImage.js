import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import mongoose from 'mongoose'
import path from 'path'
import short from 'short-uuid'

import logger from '../helpers/logger.js'

const { ObjectId } = mongoose.Types

const CORS_HEADERS = {
    'Access-Control-Max-Age': 600,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
    'Access-Control-Allow-Credentials': true,
}

const handler = async function (req, res) {
    let { Models } = req.mongo

    let workspaceId = req.params.workspaceId
    let storyId = req.params.storyId
    let screenId = req.params.screenId
    let stepId = req.params.stepId

    // sourceScreenId: select image from an existing screen (Screenshot or Page)
    // req.file: upload an image buffer directly
    let sourceScreenId = req.body && req.body.sourceScreenId
    let authUserDoc = null

    return Promise.resolve()
        .then(async () => helpers.authReq(req, Models))
        .then(({ authUser }) => {
            authUserDoc = authUser
            helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
        })
        .then(async () => {
            let previewImageUrl = ''

            if (sourceScreenId) {
                // Use the imageUrl from an existing screen
                const sourceScreen = await Models.Screen.findOne({ _id: sourceScreenId }).lean()
                if (!sourceScreen) {
                    const err = new Error('Source screen not found')
                    err.resultResponse = {
                        statusCode: ResponseCodes['400_BAD_REQUEST'] || 400,
                        headers: CORS_HEADERS,
                        body: JSON.stringify({ message: 'Source screen not found' }),
                    }
                    throw err
                }
                previewImageUrl = sourceScreen.imageUrl || ''
            } else if (req.file) {
                // Upload the provided image buffer
                let imageBuffer = req.file.buffer
                let mimeType = req.file.mimetype
                let originalName = req.file.originalname
                let ext = path.extname(originalName)
                let imageName = short.uuid() + ext

                const uploadResult = await helpers.uploadBufferImage(imageBuffer, mimeType, imageName)
                previewImageUrl = uploadResult.Location
            } else {
                const err = new Error('Either sourceScreenId or an image file is required')
                err.resultResponse = {
                    statusCode: 400,
                    headers: CORS_HEADERS,
                    body: JSON.stringify({ message: 'Either sourceScreenId or an image file is required' }),
                }
                throw err
            }

            // Only update when popup.type === 'popup' and showPreviewImage is true
            const screenDoc = await Models.Screen.findOne({
                _id: screenId,
                'steps._id': new ObjectId(stepId),
            }).lean()

            if (!screenDoc) {
                const err = new Error('Screen or step not found')
                err.resultResponse = {
                    statusCode: 404,
                    headers: CORS_HEADERS,
                    body: JSON.stringify({ message: 'Screen or step not found' }),
                }
                throw err
            }

            const step = screenDoc.steps.find(s => s._id.toString() === stepId)

            if (!step || !step.view || !step.view.popup) {
                const err = new Error('Step popup config not found')
                err.resultResponse = {
                    statusCode: 400,
                    headers: CORS_HEADERS,
                    body: JSON.stringify({ message: 'Step popup config not found' }),
                }
                throw err
            }

            if (step.view.popup.type !== 'popup' || !step.view.popup.showPreviewImage) {
                const err = new Error('previewImage can only be set when popup.type is "popup" and showPreviewImage is true')
                err.resultResponse = {
                    statusCode: 400,
                    headers: CORS_HEADERS,
                    body: JSON.stringify({ message: 'previewImage can only be set when popup.type is "popup" and showPreviewImage is true' }),
                }
                throw err
            }

            await Models.Screen.findOneAndUpdate(
                { _id: screenId, 'steps._id': new ObjectId(stepId) },
                { $set: { 'steps.$.view.popup.previewImageUrl': previewImageUrl } },
                { new: true }
            )

            return previewImageUrl
        })
        .then((previewImageUrl) => {
            res.set(CORS_HEADERS)
            res.status(ResponseCodes['200_OK'])
            res.send(JSON.stringify({ previewImageUrl }))
        })
        .catch((error) => {
            logger.error(error, { eventName: 'POST_STEP_PREVIEW_IMAGE_FAILED' })

            let resultResponse
            if (error.resultResponse) {
                resultResponse = error.resultResponse
            } else {
                resultResponse = {
                    statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
                    headers: CORS_HEADERS,
                    body: '',
                }
            }

            res.set(resultResponse.headers)
            res.status(resultResponse.statusCode)
            res.send(resultResponse.body)
        })
}

export default handler
