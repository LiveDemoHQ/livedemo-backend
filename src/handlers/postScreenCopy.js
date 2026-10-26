import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'

import ENV from '../envServer.js'
import mongoose from 'mongoose';
const { ObjectId } = mongoose.Types;
import fsp from 'fs/promises'

import logger from '../helpers/logger.js'

const {STORY_REQUESTS_FOLDER} = ENV


const SCREENDOC_ENCODING = 'utf-8'

const handler = function (req, res) {
    let {Models, conn} = req.mongo

    let requestBody = null

    let workspaceId = req.params.workspaceId
    let storyId = req.params.storyId
    let screenId = req.params.screenId
    var storyDocGlobal = null
    let authUserDoc = null

    return Promise.resolve().then(async () => {

        return helpers.authReq(req, Models)
    })
        .then(({authUser}) => {
            authUserDoc = authUser


            helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
        })
        .then(async () => {


            return Models.Story.findOne({_id: storyId, workspaceId: workspaceId})
                .then((storyDoc) => {
                    storyDocGlobal = storyDoc
                    return Models.Screen.findOne({_id: screenId}).lean()
                        .then((screenDoc) => {
                            if (screenDoc && screenDoc.recordingRole) {
                                const error = new Error('Copying rrweb screens is not supported')
                                error.resultResponse = {
                                    statusCode: ResponseCodes['409_CONFLICT'],
                                    headers: {
                                        'Access-Control-Max-Age': 600,
                                        'Access-Control-Allow-Origin': '*',
                                        'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
                                        'Access-Control-Allow-Credentials': true,
                                    },
                                    body: JSON.stringify({
                                        message: 'Copying rrweb (DOM demo) screens is not supported in v1'
                                    })
                                }
                                throw error
                            }
                            return {
                                screenDoc: screenDoc,
                            }
                        })
                })
        })
        .then(async ({screenDoc}) => {
            // Insert after editor's current screen when provided (Library import into
            // DOM demos). In-story duplicate falls back to source index. Else append.
            const afterScreenId = req.body && req.body.afterScreenId
                ? String(req.body.afterScreenId)
                : null
            let insertIndex

            if (afterScreenId) {
                const afterDoc = await Models.Screen.findOne({
                    _id: afterScreenId,
                    storyId,
                }).lean()
                if (!afterDoc) {
                    const error = new Error('afterScreenId not found in this story')
                    error.resultResponse = {
                        statusCode: ResponseCodes['404_NOT_FOUND'],
                        headers: {
                            'Access-Control-Max-Age': 600,
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
                            'Access-Control-Allow-Credentials': true,
                        },
                        body: JSON.stringify({ message: 'afterScreenId not found in this story' }),
                    }
                    throw error
                }
                insertIndex = afterDoc.index + 1
            } else if (screenDoc.storyId && String(screenDoc.storyId) === String(storyId)) {
                insertIndex = screenDoc.index + 1
            } else {
                const last = await Models.Screen.findOne({ storyId }).sort({ index: -1 }).lean()
                insertIndex = last ? last.index + 1 : 0
            }

            await Models.Screen.updateMany(
                { storyId, index: { $gte: insertIndex } },
                { $inc: { index: 1 } },
            )

            return { screenDoc, nextIndex: insertIndex }
        })
        .then(async ({screenDoc, nextIndex}) => {

            let newScreenId = new ObjectId()

            // Clone embedded steps with unique _ids (keep data, drop old ids so mongoose regenerates)
            screenDoc.steps = (screenDoc.steps || []).map((step) => {
                const {_id, createdAt, updatedAt, ...stepData} = step
                if (stepData.zoomSpan && stepData.zoomSpan._id) {
                    delete stepData.zoomSpan._id
                    delete stepData.zoomSpan.createdAt
                    delete stepData.zoomSpan.updatedAt
                }
                if (stepData.view?.popup?.buttons) {
                    stepData.view.popup.buttons = stepData.view.popup.buttons.map((btn) => {
                        const {_id: btnId, ...btnData} = btn
                        return btnData
                    })
                }
                return stepData
            })

            let storyDir = `${ENV.STORIES_FOLDER}/${storyId}`
            let newScreenDir = `${storyDir}/${newScreenId}.html`

            if (screenDoc.type === 'Screen_Page') {

                return fsp.readFile(screenDoc.contentPath, {encoding: SCREENDOC_ENCODING})

                    .then((contentString) => {
                        return fsp.writeFile(newScreenDir, contentString)
                    })
                    .then(() => {

                        return new Models.Screen({
                            ...screenDoc,
                            _id: newScreenId,
                            index: nextIndex,
                            storyId: storyId,
                            contentPath: newScreenDir,
                        })
                            .save()
                    })
                    .then((newScreenDoc) => {
                        return Models.Story.findOneAndUpdate({_id: storyId}, {
                            $push: {
                                screens: newScreenId
                            }
                        })
                            .then(() => {
                                let pushPath = 'library.pages'

                                return Models.Workspace.findOneAndUpdate({_id: workspaceId}, {
                                    $addToSet: {[pushPath]: newScreenId}
                                })
                            })
                            .then(() => {
                                return newScreenDoc
                            })
                    })
            } else {

                let newTransitions = screenDoc.customTransitions.map(transition => {
                    delete transition._id
                })

                let initPromise = Promise.resolve([])

                if (newTransitions.length !== 0) {

                    initPromise = initPromise.then(() => Models.ScreenScreenshotTransition.insertMany(newTransitions))
                }


                return initPromise.then((newTransitionDocs) => {
                    screenDoc.customTrasitions = newTransitionDocs
                    screenDoc.storyId = storyId
                    screenDoc.index = nextIndex

                    return new Models.Screen({
                        ...screenDoc,
                        _id: newScreenId,
                        index: nextIndex,
                    }).save()
                })
                    .then((newScreenDoc) => {
                        return Models.Story.findOneAndUpdate({_id: storyId}, {
                            $push: {
                                screens: newScreenId
                            }
                        })
                            .then(() => {
                                let pushPath = screenDoc.type === 'Screen_Screenshot' ? 'library.screenshots' : 'library.videos'

                                return Models.Workspace.findOneAndUpdate({_id: workspaceId}, {
                                    $addToSet: {[pushPath]: newScreenId}
                                })
                            })
                            .then(() => {
                                return newScreenDoc
                            })
                    })
            }
        })
        .then((screenDoc) => {

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
            res.send(JSON.stringify(screenDoc))
        })
        .catch((error) => {
            logger.error(error, { eventName: 'POST_SCREEN_COPY_FAILED' })

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
