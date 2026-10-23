import helpers from '../helpers/livedemoHelpers.js'
import postAutoRecordingsEventsValidator
    from '../helpers/validators/workspaces/auto-recordings/events/postAutoRecordingsEventsValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import DemoLimits from '../constants/DemoLimits.js'

const handler = function (req, res) {
    let {Models, conn} = req.mongo


    let workspaceId = req.params.workspaceId
    let autoRecordingId = req.params.autoRecordingId
    let requestBody = null
    let authUserDoc = null

    return Promise.resolve()
        // .then(async () => {

        // return helpers.authReq(req, Models)
        // })
        .then(() => {
            // authUserDoc = authUser
            let validatedBody = helpers.validateBody(req.body, postAutoRecordingsEventsValidator)
            requestBody = validatedBody.value

            // helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
        })
        .then(() => {
            return Models.AutoRecording.findOne({_id: autoRecordingId}).lean()
        })
        .then((autoRecordingDoc) => {
            if (!autoRecordingDoc) {
                throw new Error('AutoRecording not found')
            }


            let events = requestBody.events || []
            const existingClicks = (autoRecordingDoc.sessionData && autoRecordingDoc.sessionData.eventsClickCount) || 0
            const room = Math.max(0, DemoLimits.MAX_AI_RECORDING_CLICKS - existingClicks)
            events = events.slice(0, room)

            let eventClicksCount = events.length

            events = events.map((event) => {

                return {
                    autoRecordingId: autoRecordingDoc._id.toString(16),
                    eventData: {
                        data: JSON.stringify(event),
                        timestamp: event.timeMs,
                    },
                    workspaceId: workspaceId,
                }
            })

            let promiseAfterInsert = Promise.resolve()


            if (events.length) {
                let lastEvent = events[events.length - 1]

                let duration = lastEvent.eventData.timestamp - autoRecordingDoc.sessionData.startTimestamp
                let endTimestamp = lastEvent.eventData.timestamp

                promiseAfterInsert = promiseAfterInsert.then(() => {
                    return Models.AutoRecording.findOneAndUpdate({_id: autoRecordingDoc._id}, {
                        $set: {
                            "sessionData.duration": duration,
                            "sessionData.endTimestamp": endTimestamp,
                            "sessionData.eventsClickCount": autoRecordingDoc.sessionData.eventsClickCount + eventClicksCount,
                        }
                    }, {
                        new: true,
                        overwrite: false
                    })
                })
            }

            if (!events.length) {
                return []
            }

            return Models.AutoRecordingEvent.insertMany(events)
                .then(autoRecordingEvents => {

                    return promiseAfterInsert
                        .then(() => autoRecordingEvents)
                })
        })
        .then((autoRecordingEvents) => {

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
            res.send('')
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
