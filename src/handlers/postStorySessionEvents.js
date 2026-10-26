import helpers from '../helpers/livedemoHelpers.js'
import postStorySessionEventsValidator from '../helpers/validators/stories/sessions/events/postStorySessionEventsValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import mongoose from 'mongoose';
const { ObjectId } = mongoose.Types;
import monq from 'monq'
import ENV from '../envServer.js'
import { emitDemoEvent } from '../helpers/workspaceEvents.js'

import logger from '../helpers/logger.js'

function enqueueDemoCompletionEvent(storyId, sessionId, sessionEventId) {
  const client = monq(ENV.DB_URI || 'mongodb://localhost:27017/livedemo_app')
  const queue = client.queue('demoActivityEvents', { collection: 'jobs-monq' })

  return new Promise((resolve, reject) => {
    let jobName = 'completion-event'
    queue.enqueue(jobName, { storyId, sessionId, sessionEventId }, function (err, job) {
      if (err) {
        reject(err)
      }
      logger.info('Enqueued completion-event:', {
          eventName: 'ENQUEUED_COMPLETION_EVENT',
          onOneLine: true,
          data: { detail: job.data }
      })
      resolve()
    })
  })
}

const handler = function (req, res) {
  let { Models, conn } = req.mongo


  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let sessionId = req.params.sessionId
  let requestBody = null
  let authUserDoc = null

  return Promise.resolve()
    // .then(async () => {

      // return helpers.authReq(req, Models)
    // })
    .then(() => {
      // authUserDoc = authUser
      let validatedBody = helpers.validateBody(req.body, postStorySessionEventsValidator)
      requestBody = validatedBody.value

      // helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(() => {
      return Models.Session.findOne({ _id: sessionId }).lean()
    })
    .then((sessionDoc) => {
      if(!sessionDoc) {
        throw new Error('Session not found')
      }


      let events = requestBody.events

      let eventClicksCount = events.reduce((accum, event) => {
        if (
          event.data && event.data.source && event.data.source === 2 &&
          event.data && event.data.type && event.data.type === 2
        ) {
          accum += 1
        }

        return accum
      }, 0)

      events = events.map((event) => {
        let dataSource = event.data && event.data.source
        let dataType = event.data && event.data.type

        return {
          _id: new ObjectId(),
          sessionId: sessionDoc._id.toString(16),
          eventData: {
            data: JSON.stringify(event.data),
            timestamp: event.timestamp,
            type: event.type,
            dataSource: dataSource,
            dataType: dataType
          },
          stepIndex: event.stepIndex,
          workspaceId: workspaceId,
          storyId: storyId,
        }
      })

      let promiseAfterInsert = Promise.resolve()



      if (events.length) {
        let lastEvent = events[events.length - 1]

        let duration = lastEvent.eventData.timestamp - sessionDoc.startTimestamp
        let endTimestamp = lastEvent.eventData.timestamp

        let dropOffStep = lastEvent.stepIndex
        let didPlay = lastEvent.stepIndex !== 0
        let didComplete = sessionDoc.stepsCount && lastEvent.stepIndex === sessionDoc.stepsCount - 1

        // dropOffStep: {type: Number},
        // didPlay: {type: Boolean, default: false},
        // didComplete: {type: Boolean, default: false},

        promiseAfterInsert = promiseAfterInsert.then(() => {
          return Models.Session.findOneAndUpdate({ _id: sessionDoc._id }, {
            $set: {
              duration: duration,
              endTimestamp,
              eventsClickCount: sessionDoc.eventsClickCount + eventClicksCount,
              dropOffStep,
              didPlay,
              didComplete
            }
          }, {
            new: true,
            overwrite: false
          })
          .then(() => {
            let notUpdatedSessionDoc = sessionDoc 

            if (!notUpdatedSessionDoc.didComplete && didComplete) {

              emitDemoEvent(Models, notUpdatedSessionDoc.storyId || storyId, 'demo.completed', { session: notUpdatedSessionDoc })
            }

            if(!ENV.PROCESS_DEMO_ACTIVITY_EVENTS) {
              return notUpdatedSessionDoc
            }
            

            if(!notUpdatedSessionDoc.didComplete && didComplete) {
              // Did complete the story - unique event
              return enqueueDemoCompletionEvent(storyId, notUpdatedSessionDoc._id.toString(), lastEvent._id.toString())
            }
            return notUpdatedSessionDoc
          })
        })
      }

      return Models.SessionEvent.insertMany(events)
        .then(newSessionEvents => {

          return promiseAfterInsert
            .then(() => newSessionEvents)
        })
    })
    .then((newSessionEvents) => {

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
      logger.error(error, {
          eventName: 'POST_STORY_SESSION_EVENTS_FAILED',
          onOneLine: true
      })

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

export default  handler
