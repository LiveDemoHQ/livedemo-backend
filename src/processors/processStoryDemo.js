import fsp from 'fs/promises'
import ENV_VARS from '../envServer.js'
import StoryStatuses from '../constants/StoryStatuses.js'
import ScreenTypes from '../constants/ScreenTypes.js'
import StoryTypes from '../constants/StoryTypes.js'
import flixHelpers from '../helpers/flixHelpers.js'
import he from 'he'

import logger from '../helpers/logger.js'

const MIN_VIDEO_DURATION_SEC_FOR_END_ZOOM = 2
const END_ZOOM_DURATION_SEC = 1.5
const END_ZOOM_MIN_BOX_RATIO = 0.65

/**
 * @param {object} asset - Mux asset object stored on Screen_Video
 * @returns {number} duration in seconds
 */
function getMuxAssetDurationSeconds(asset) {
    if (!asset) {
        return 0
    }
    const raw = asset.duration ?? asset.tracks?.[0]?.duration
    if (raw === undefined || raw === null) {
        return 0
    }
    const n = typeof raw === 'number' ? raw : parseFloat(raw)
    return Number.isFinite(n) ? n : 0
}

/**
 * For each screen video clip longer than 3s, adds a zoom span in the last 1.5s of the clip,
 * anchored toward the last cursor position in that segment. The zoom box is at least 80% of
 * editor width and height (from windowMeasures), clamped so it stays inside the frame.
 *
 * @param {Array} screenVideos - Screen_Video payloads (mutated in place)
 * @param {Array} renderEvents - from getRenderEvents; used to match video segments to time ranges
 * @param {Array} insertedCursorPositions - docs with timeMs, frameX, frameY
 * @param {object} windowMeasures - story windowMeasures (innerWidth / innerHeight)
 */
function addEndZoomSpansToScreenVideos(screenVideos, renderEvents, insertedCursorPositions, windowMeasures) {
    const editorWidth = windowMeasures?.innerWidth ?? 1920
    const editorHeight = windowMeasures?.innerHeight ?? 1080

    const minBoxW = END_ZOOM_MIN_BOX_RATIO * editorWidth
    const minBoxH = END_ZOOM_MIN_BOX_RATIO * editorHeight

    let videoIdx = 0
    for (let i = 0; i < renderEvents.length; i++) {
        const event = renderEvents[i]
        if (event.type !== 'video') {
            continue
        }
        const screenVideo = screenVideos[videoIdx]
        videoIdx += 1
        if (!screenVideo) {
            continue
        }

        const durationSec = getMuxAssetDurationSeconds(screenVideo.asset)
        if (durationSec <= MIN_VIDEO_DURATION_SEC_FOR_END_ZOOM) {
            continue
        }

        const cursorsInSegment = insertedCursorPositions
            .filter((doc) => doc.timeMs >= event.startTime && doc.timeMs < event.endTime)
            .sort((a, b) => a.timeMs - b.timeMs)

        if (cursorsInSegment.length === 0) {
            continue
        }

        const last = cursorsInSegment[cursorsInSegment.length - 1]
        const cx = last.frameX
        const cy = last.frameY

        const boxW = minBoxW
        const boxH = minBoxH

        let offsetX = cx - boxW / 2
        let offsetY = cy - boxH / 2
        offsetX = Math.max(0, Math.min(offsetX, editorWidth - boxW))
        offsetY = Math.max(0, Math.min(offsetY, editorHeight - boxH))

        const startTime = Math.max(0, durationSec - END_ZOOM_DURATION_SEC)

        screenVideo.zoomSpans = [
            {
                startTime,
                duration: END_ZOOM_DURATION_SEC,
                width: boxW,
                height: boxH,
                editorWidth,
                editorHeight,
                offsetX,
                offsetY
            }
        ]
    }
}

async function processStoryDemo(sharedConfig, params, callback) {
    const { Models, axios } = sharedConfig
    const { storyDemoId } = params

    logger.info(`Started - processStoryDemo - ${storyDemoId}`, { eventName: 'PROCESS_STORY_DEMO' })

    return Models.Story.findOne({ _id: storyDemoId })
        .lean()
        .then((storyDemoDoc) => {

            // Allow re-proccessing of StoryDemos if the job is queued again,
            // but it does result in old screens being left-out without StoryDemo
            // if (storyDemoDoc.status !== StoryStatuses.UPLOADING || !storyDemoDoc.filePath) {
            if (!storyDemoDoc.filePath) {
                throw new Error(`Cannot process storyDemo either has incorrect status - ${storyDemoDoc.status} or missing filePath - ${storyDemoDoc.filePath}`)
            } else {

                return fsp.readFile(storyDemoDoc.filePath, { encoding: 'utf8' })
                    .then((storyDemoJsonString) => {
                        return {
                            storyDemoDoc,
                            requestBody: JSON.parse(storyDemoJsonString)
                        }
                    })
            }

        })
        .then(({ storyDemoDoc, requestBody }) => {
            let name = storyDemoDoc.name
            let workspaceId = storyDemoDoc.workspaceId

            let capturedEvents = storyDemoDoc.capturedEvents
            let videoStartMs = storyDemoDoc.videoStartMs
            let videoEndMs = storyDemoDoc.videoEndMs
            let renderEvents = {}

            let videoAssetId = ''

            let storyId = storyDemoDoc._id.toString(16)

            let screenshots = {}
            let videos = {}
            let hasCursorPositionsFlag = false

            // renderEvents = flixHelpers.getRenderEvents(capturedEvents, videoStartMs, videoEndMs, screenshots)

            return flixHelpers.uploadMuxVideo(requestBody.videoBase64)
                .then((videoUploadRes) => {

                    // console.log(videoUploadRes)
                    videoAssetId = videoUploadRes.id

                    let videoDurationInSeconds = videoUploadRes.tracks[0].duration ?? videoUploadRes.duration
                    videoEndMs = videoStartMs + (videoDurationInSeconds * 1000)
                    // let differenceBetweenNewAndOldVideoEndMs = newVideoEndMs - videoEndMs
                    // if(differenceBetweenNewAndOldVideoEndMs !== 0) {
                    //     videoEndMs = newVideoEndMs
                    //
                    //     for(let i = 0; i < capturedEvents.length; i++) {
                    //         let event = capturedEvents[i]
                    //         event.timeMs = event.timeMs + differenceBetweenNewAndOldVideoEndMs
                    //     }
                    // }
                    const screenshotEntries = Object.entries(requestBody.screenshots)
                    const firstScreenshotKey = screenshotEntries.length > 0 ? screenshotEntries[0][0] : null

                    return Promise.all(screenshotEntries.map(function ([key, value]) {
                        return flixHelpers.uploadImage(value, storyId + '/' + key)
                            .then(res => {
                                let imgObj = {}
                                imgObj.name = key
                                imgObj.imageUrl = res.Location

                                return imgObj
                            })
                    }))
                })
                .then((imageUploadResults) => {

                    let imgsObj = imageUploadResults.reduce(function (accum, imgObj) {
                        accum[imgObj.name] = imgObj
                        return accum
                    }, {})

                    screenshots = imgsObj

                    const firstScreenshotKey = Object.keys(screenshots)[0]
                    const thumbnailImageUrl = firstScreenshotKey ? screenshots[firstScreenshotKey].imageUrl : null

                    if (thumbnailImageUrl) {
                        return Models.Story.findOneAndUpdate({ _id: storyId }, {
                            $set: { thumbnailImageUrl }
                        })
                    }
                })
                .then(() => {

                    renderEvents = flixHelpers.getRenderEvents(capturedEvents, videoStartMs, videoEndMs, screenshots)

                    return flixHelpers.createMuxClips(videoAssetId, renderEvents)
                        .then((assets) => {

                            logger.info(assets, { eventName: 'PROCESS_STORY_DEMO' })
                            videos = assets.reduce((accum, asset) => {
                                accum[asset.videoId] = asset

                                return accum
                            }, {})
                        })
                })
                .then(() => {
                    let cursorPositionDocs = flixHelpers.buildCursorPositionDocs(storyId, requestBody.cursorPositions)
                    hasCursorPositionsFlag = cursorPositionDocs.length > 0

                    return flixHelpers.insertStoryCursorPositions(Models.CursorPositions, cursorPositionDocs)
                        .then((insertedCursorPositions) => {

                            let screenScreenshots = []
                            let screenVideos = []

                            for (let i = 0; i < renderEvents.length; i++) {
                                let event = renderEvents[i]
                                let screenIndex = i

                                if (event.type === 'video') {

                                    screenVideos.push({
                                        asset: videos[event.videoId],

                                        index: screenIndex,
                                        workspaceId,
                                        userId: storyDemoDoc.userId,
                                        storyId,
                                        type: ScreenTypes.SCREEN_VIDEO,
                                        cursorPositions: flixHelpers.getCursorPositionIdsForVideoSegment(
                                            insertedCursorPositions,
                                            event.startTime,
                                            event.endTime
                                        ),
                                        steps: [],
                                    })
                                }

                                if ((event.type === 'image' && screenshots[event.imageId]) &&
                                    (event.frameX !== 0 && event.frameY !== 0)
                                ) {
                                    let steps = []

                                    if (event.frameX) {

                                        let contentText = event.targetText ? `<p>Click on ${event.targetText}</p>` : `<p>Click here</p>`

                                        steps.push({
                                            index: 0,
                                            view: {
                                                hotspot: {
                                                    frameX: event.frameX,
                                                    frameY: event.frameY,
                                                },
                                                viewType: 'hotspot',
                                                content: contentText,
                                            },
                                            elementData: {
                                                // targetHTML: event.targetHTML,
                                                targetHTML: he.encode(event.targetHTML),
                                                targetElementType: event.targetElementType,
                                                targetText: event.targetText
                                            }
                                        })
                                    }

                                    screenScreenshots.push({
                                        imageUrl: screenshots[event.imageId].imageUrl,
                                        steps: steps,


                                        index: screenIndex,
                                        workspaceId,
                                        userId: storyDemoDoc.userId,
                                        storyId,
                                        type: ScreenTypes.SCREEN_SCREENSHOT,
                                    })
                                }

                            }

                            addEndZoomSpansToScreenVideos(
                                screenVideos,
                                renderEvents,
                                insertedCursorPositions,
                                storyDemoDoc.windowMeasures
                            )

                            return Promise.all([
                                Models.Screen_Screenshot.insertMany(screenScreenshots),
                                Models.Screen_Video.insertMany(screenVideos)
                            ])
                        })
                })
                .then(([screenShotResults, videoResults]) => {
                    let screensArr = screenShotResults.concat(videoResults).sort((first, second) => first.index - second.index)

                    return Models.Story.findOneAndUpdate({ _id: storyId }, {
                        $set: {
                            screens: screensArr,
                            status: StoryStatuses.READY,
                            videoEndMs: videoEndMs,
                            ...(hasCursorPositionsFlag ? { hasCursorPositions: true } : {}),
                            ...(storyDemoDoc.type === StoryTypes.desktop
                                ? { 'custom.misc.isOmniBarDisabled': true }
                                : {}),
                        }
                    },
                        { new: true })
                        .then((newStoryDoc) => {

                            return Models.Workspace.findOneAndUpdate({ _id: workspaceId }, {
                                $addToSet: {
                                    'library.screenshots': { $each: screenShotResults },
                                    'library.videos': { $each: videoResults }
                                }
                            })
                                .then(() => {
                                    return newStoryDoc
                                })
                        })
                })


        })
        .then(() => {
            logger.info('processStoryDemo completed - end', { eventName: 'PROCESSSTORYDEMO_COMPLETED_END' })
            callback(null, { storyDemoId })
        })
        .catch(err => {
            logger.error('processStoryDemo failed - end', { eventName: 'PROCESSSTORYDEMO_FAILED_END_FAILED' })
            logger.error(err, { eventName: 'PROCESS_STORY_DEMO_FAILED' })

            let endPromise = Promise.resolve()

            endPromise = endPromise.then(() => {

                return Models.Story.findOneAndUpdate({ _id: storyDemoId }, {
                    $set: {
                        status: StoryStatuses.FAILED
                    }
                })
            })

            return endPromise.then(() => {

                callback(err)
            })
        })


}


const config = {
    queueNames: ['storyDemos'],
    jobNames: ['processStoryDemo'],
    handler: processStoryDemo
}

export default config
