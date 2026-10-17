import helpers from '../helpers/livedemoHelpers.js'
import postStorySessionValidator from '../helpers/validators/stories/sessions/postStorySessionValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import ENV from '../envServer.js'
import moment from "moment"
import monq from 'monq'
import isAnalyticsExcludedIp from '../helpers/isAnalyticsExcludedIp.js'
import { emitDemoEvent } from '../helpers/workspaceEvents.js'

function enqueueDemoVisitEvent(storyId, sessionId) {
  const client = monq(ENV.DB_URI || 'mongodb://localhost:27017/livedemo_app')
  const queue = client.queue('demoActivityEvents', { collection: 'jobs-monq' })

  return new Promise((resolve, reject) => {
    let jobName = 'visit-event'
    queue.enqueue(jobName, { storyId, sessionId }, function (err, job) {
      if (err) {
        reject(err)
      }
      console.log('Enqueued demo-visit-event:', job.data)
      resolve()
    })
  })
}

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let requestBody = null
  let authUserDoc = null
  let isExcluded = false

  let clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'] : (ENV.ENV === 'dev' ? '69.200.224.152' : '')
  // Make sure to get the Client IP, because there could be multiple IPs in the x-forwarded-for header
  clientIp = clientIp.split(',')[0]

  return Promise.resolve()
    // .then(async () => {

      // return helpers.authReq(req, Models)
    // })
    .then(() => {
      // authUserDoc = authUser
      let validatedBody = helpers.validateBody(req.body, postStorySessionValidator)
      requestBody = validatedBody.value

      // helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(() => isAnalyticsExcludedIp(clientIp, Models, workspaceId))
    .then((excluded) => {
      isExcluded = excluded
      if(clientIp && !isExcluded) {

        return helpers.getClientIpData(clientIp)
      }
    })
    .then((clientIpData) => {
      // No session = the demo bundle does not start recording
      if(isExcluded) {

        return null
      }

      let sessionObj = {
        storyId: storyId,
        workspaceId: workspaceId,
        clientIpData: {
          ip: clientIpData.ip,
          continent: clientIpData.continent,
          continent_code: clientIpData.continent_code,
          country: clientIpData.country,
          country_code: clientIpData.country_code,
          region: clientIpData.region,
          city: clientIpData.city,
          latitude: clientIpData.latitude,
          longitude: clientIpData.longitude,
          is_eu: clientIpData.is_eu,
          postal: clientIpData.postal,
          calling_code: clientIpData.calling_code,
          flag: clientIpData.flag,
          timezone: clientIpData.timezone,
        },
        startTimestamp: moment().valueOf()
      }

      if(requestBody.stepsCount) {
        sessionObj.stepsCount = requestBody.stepsCount
      }

      return new Models.Session(sessionObj).save()
    })
    .then((sessionDoc) => {
      if (sessionDoc) {

        emitDemoEvent(Models, storyId, 'demo.viewed', { session: sessionDoc })
      }

      if(!sessionDoc || !ENV.PROCESS_DEMO_ACTIVITY_EVENTS) {
        return sessionDoc
      }
      
      // Enqueue demo-visit-event with storyId and sessionId
      return enqueueDemoVisitEvent(storyId, sessionDoc._id.toString())
        .then(() => sessionDoc)
        .catch((err) => {
          // Log error but don't fail the request if enqueueing fails
          console.error('Failed to enqueue demo-visit-event:', err)
          return sessionDoc
        })
    })
    .then((sessionDoc) => {

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
      res.send(JSON.stringify(sessionDoc || { recordingDisabled: true }))
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

export default  handler
