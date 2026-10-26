import ResponseCodes from '../constants/ResponseCodes.js'
import mongoose from 'mongoose';
const { ObjectId } = mongoose.Types;
import helpers from '../helpers/livedemoHelpers.js'
import StoryStatuses from '../constants/StoryStatuses.js'
import ScreenTypes from '../constants/ScreenTypes.js'
import short from 'short-uuid'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
    let {Models, conn} = req.mongo

    // Route should be: /workspaces/:workspaceId/demo-suggestions/:demoSuggestionId/generate-livedemo
    let workspaceId = req.params.workspaceId
    let demoSuggestionId = req.params.demoSuggestionId
    let demoSuggestionDoc = null

    return Promise.resolve()
        .then(() => {
            // Find the DemoSuggestion
            return Models.DemoSuggestion.findOne({
                _id: demoSuggestionId,
                workspaceId: workspaceId
            }).lean()
        })
        .then((foundDemoSuggestion) => {
            if (!foundDemoSuggestion) {
                throw new Error('DemoSuggestion not found')
            }
            demoSuggestionDoc = foundDemoSuggestion
        })
        .then(() => {
            // Create a Story from DemoSuggestion
            return new Models.Story({
                name: demoSuggestionDoc.name || 'Generated Story',
                workspaceId: demoSuggestionDoc.workspaceId,
                status: StoryStatuses.READY,
                screens: [],
                windowMeasures: demoSuggestionDoc.windowMeasures
            }).save()
        })
        .then((newStory) => {
            // Create screens from DemoSuggestion steps
            if (!demoSuggestionDoc.steps || demoSuggestionDoc.steps.length === 0) {
                return { story: newStory, screens: [] }
            }

            // Get all autoRecordingEventIds from steps
            const autoRecordingEventIds = demoSuggestionDoc.steps
                .map(step => step.autoRecordingEventId)
                .filter(id => id)

            // Find all AutoRecordingEvents
            return Models.AutoRecordingEvent.find({
                _id: { $in: autoRecordingEventIds }
            }).lean()
                .then((autoRecordingEvents) => {
                    // Create a map of eventId -> eventData for quick lookup
                    const eventMap = {}
                    autoRecordingEvents.forEach(event => {
                        eventMap[event._id.toString()] = event
                    })

                    // Process each step to create a screen
                    const screenPromises = demoSuggestionDoc.steps.map(async (step, index) => {
                        let imageUrl = ''
                        
                        // If step has autoRecordingEventId, get imageData from the event
                        if (step.autoRecordingEventId) {
                            try {
                                const event = eventMap[step.autoRecordingEventId.toString()]
                                if (event && event.eventData && event.eventData.data) {
                                    const eventData = JSON.parse(event.eventData.data)
                                    if (eventData.imageData) {
                                        // Upload imageData to S3
                                        const imageName = short.uuid() + '.png'
                                        const uploadResult = await helpers.uploadImage(eventData.imageData, imageName)
                                        imageUrl = uploadResult.Location
                                    }
                                }
                            } catch (error) {
                                logger.error(`Failed to retrieve/upload image for step ${index}:`, { eventName: 'POST_DEMO_SUGGESTIONS_GENERATE_LIVE_DEMO_FAILED', err: error })
                                // Continue without image if retrieval fails
                            }
                        }

                        // step.y = (step.y * demoSuggestionDoc.windowMeasures.devicePixelRatio) //- 45 //(45 * (2 - demoSuggestionDoc.windowMeasures.devicePixelRatio))
                        // step.x = (step.x * demoSuggestionDoc.windowMeasures.devicePixelRatio) //+ 45 //(45 * (2 - demoSuggestionDoc.windowMeasures.devicePixelRatio))
                        // Create a step for the screen based on DemoSuggestion step
                        const screenStep = {
                            index: 0,
                            view: {
                                viewType: step.type === 'click' ? 'hotspot' : 'pointer',
                                hotspot: step.type === 'click' ? {
                                    frameX: step.x || 200,
                                    frameY: step.y || 200,
                                    placement: 'auto'
                                } : undefined,
                                pointer: step.type !== 'click' ? {
                                    selector: '',
                                    selectorLocation: {
                                        positionX: step.x || 200,
                                        positionY: step.y || 200,
                                        width: 150,
                                        height: 50
                                    },
                                    placement: 'auto'
                                } : undefined,
                                content: step.explanation ? `<p>${step.explanation}</p>` : ''
                            },
                            action: {
                                actionType: 'NextButton'
                            }
                        }

                        // Create the screen
                        const screenObj = {
                            name: `Step ${index + 1}`,
                            workspaceId: demoSuggestionDoc.workspaceId,
                            storyId: newStory._id,
                            type: ScreenTypes.SCREEN_SCREENSHOT,
                            imageUrl: imageUrl,
                            index: index,
                            steps: [screenStep]
                        }

                        return new Models.Screen_Screenshot(screenObj).save()
                    })

                    return Promise.all(screenPromises)
                        .then((screens) => {
                            // Add screens to the Story
                            const screenIds = screens.map(screen => screen._id)
                            return Models.Story.findOneAndUpdate(
                                { _id: newStory._id },
                                {
                                    $set: {
                                        screens: screenIds,
                                        demoSuggestionId: demoSuggestionId
                                    }
                                },
                                { new: true }
                            )
                                .then(() => {
                                    return { story: newStory, screens }
                                })
                        })
                })
        })
        .then(({ story, screens }) => {
            // Update the DemoSuggestion with liveDemoId (which references Story)
            return Models.DemoSuggestion.findOneAndUpdate(
                { _id: demoSuggestionId },
                {
                    $set: {
                        liveDemoId: story._id
                    }
                },
                {
                    new: true
                }
            )
                .then(() => {
                    return story
                })
        })
        .then((newStoryDoc) => {
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
            res.send(JSON.stringify(newStoryDoc))
        })
        .catch((error) => {
            logger.error(error, { eventName: 'POST_DEMO_SUGGESTIONS_GENERATE_LIVE_DEMO_FAILED' })

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

