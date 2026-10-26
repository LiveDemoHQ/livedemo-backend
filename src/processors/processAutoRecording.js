import fsp from 'fs/promises'
import ENV_VARS from '../envServer.js'
import StoryStatuses from '../constants/StoryStatuses.js'
import ScreenTypes from '../constants/ScreenTypes.js'
import flixHelpers from '../helpers/flixHelpers.js'
import he from 'he'
import AutoRecordingStatuses from "../constants/AutoRecordingStatuses.js"
import {

    AutoRecordingManager
} from '../helpers/autoRecordingManager.js'
import logger from '../helpers/logger.js'

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function processAutoRecording(sharedConfig, params, callback) {
    const {Models, axios} = sharedConfig
    const {autoRecordingId} = params
    let autoRecordingManager = null

    try {
        let autoRecordingDoc = await Models.AutoRecording.findOne({_id: autoRecordingId})
        let autoRecordingManager = new AutoRecordingManager(autoRecordingDoc.aiName, autoRecordingDoc.windowMeasures)
        let counterInSeconds = 0
        // Wait maximum 5 minutes
        while (autoRecordingDoc.status === AutoRecordingStatuses.recording && counterInSeconds < 60 * 5) {

            await sleep(1000)
            let events = await Models.AutoRecordingEvent.find({autoRecordingId: autoRecordingDoc._id}).lean()
            await autoRecordingManager.processEvents(events)

            counterInSeconds += 1
            autoRecordingDoc = await Models.AutoRecording.findOne({_id: autoRecordingId})
        }


        let events = await Models.AutoRecordingEvent.find({autoRecordingId: autoRecordingDoc._id}).lean()
        // let preparedEvents = prepareEvents(events);
        await autoRecordingManager.processEvents(events)
        let demoSuggestionsArr = await autoRecordingManager.finalize()

        // console.log('demoSuggestions')
        // console.log(demoSuggestionsArr)

        demoSuggestionsArr = demoSuggestionsArr.map(demoSuggestion => {
            demoSuggestion.autoRecordingId = autoRecordingDoc._id
            demoSuggestion.workspaceId = autoRecordingDoc.workspaceId
            demoSuggestion.windowMeasures = autoRecordingDoc.windowMeasures

            return demoSuggestion
        })

        if (demoSuggestionsArr && demoSuggestionsArr.length > 0) {

            await Models.DemoSuggestion.insertMany(demoSuggestionsArr)
                .then(demoSuggestionIds => {
                    return Models.AutoRecording.findOneAndUpdate({_id: autoRecordingDoc._id}, {
                        $set: {
                            demoSuggestions: demoSuggestionIds,
                        }
                    }, {
                        new: true,
                        overwrite: false
                    })
                })
        }

        let autoRecordingImageData = demoSuggestionsArr[0] && demoSuggestionsArr[0].thumbnailImageData ? demoSuggestionsArr[0].thumbnailImageData : ''

        await Models.AutoRecording.findOneAndUpdate({_id: autoRecordingId}, {
            $set: {
                status: AutoRecordingStatuses.completed,
                thumbnailImageData: autoRecordingImageData
            }
        })

        // Delete uploaded openAI images from openai
        await autoRecordingManager.deleteAllUploadedOpenAiImages()

        logger.info('processAutoRecording completed - end', { eventName: 'PROCESSAUTORECORDING_COMPLETED_END' })
        callback(null, {autoRecordingId, demoSuggestionsArr})
    } catch (err) {
        logger.error('processAutoRecording failed - end', { eventName: 'PROCESSAUTORECORDING_FAILED_END_FAILED' })
        logger.error(err, { eventName: 'PROCESS_AUTO_RECORDING_FAILED' })

        let endPromise = Promise.resolve()

        endPromise = endPromise.then(() => {

            return Models.AutoRecording.findOneAndUpdate({_id: autoRecordingId}, {
                $set: {
                    status: AutoRecordingStatuses.failed,
                }
            })
        })

        await endPromise.then(() => {

            callback(err)
        })
    }
}




const config = {
    queueNames: ['autoRecordings'],
    jobNames: ['processAutoRecording'],
    handler: processAutoRecording
}

export default config
