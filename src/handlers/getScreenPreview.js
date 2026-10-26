import helpers from '../helpers/livedemoHelpers.js'
const SCREENDOC_ENCODING = 'utf-8'
import ENV from '../envServer.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import fsp from 'fs/promises'
import { decodeRrwebEvents } from '../helpers/rrwebEventNames.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let screenId = req.params.screenId

  return Promise.resolve().then(async () => {
      return Models.Screen.findOne({
          _id: screenId
        })
          .populate({
            path: 'steps',
            populate: [
              {
                path: 'view.popup.formId',
                model: 'Form',
              },
              {
                path: 'stepAudioId',
                model: 'Audio',
              }
            ],
            options: { sort: { 'index': 1 } }
          })
        .lean()
    })
    .then(async (screenDoc) => {
      // rrweb screens: return events JSON, skip HTML domain-script injection
      if (screenDoc && screenDoc.recordingRole) {
        const eventsPath = screenDoc.recordingRole === 'base'
          ? screenDoc.snapshotPath
          : screenDoc.eventsPath

        if (!eventsPath) {
          return { screenDoc, events: [] }
        }

        const eventsString = await fsp.readFile(eventsPath, { encoding: SCREENDOC_ENCODING })
        let events = []
        try {
          events = decodeRrwebEvents(JSON.parse(eventsString))
        } catch (e) {
          logger.error('Failed to parse rrweb events', { eventName: 'FAILED_TO_PARSE_RRWEB_EVENTS_FAILED', err: e })
          events = []
        }

        return { screenDoc, events, isRrweb: true }
      }

      if (screenDoc && screenDoc.contentPath) {
        return fsp.readFile(screenDoc.contentPath, { encoding: SCREENDOC_ENCODING })
          .then((contentString) => {
            let scriptToAppend = `<script>document.domain = "${ENV.URL_COMMON_DOMAIN}"</script>\n`
            scriptToAppend += '<style>@keyframes pulse {\n\t0% {\n\t\ttransform: scale(0.98);\n\t\tbox-shadow: 0 0 0 0 rgba(16, 112, 255, 0.7);\n\t}\n\n\t70% {\n\t\ttransform: scale(1);\n\t\tbox-shadow: 0 0 0 10px rgba(16, 112, 255, 0);\n\t}\n\n\t100% {\n\t\ttransform: scale(0.98);\n\t\tbox-shadow: 0 0 0 0 rgba(16, 112, 255, 0);\n\t}\n}</style>'

            let respBodyFinal = contentString.replace(/(<\s*head[\W\w]*?[^>]*>)/, '$1\n' + scriptToAppend)

            screenDoc.contentString = respBodyFinal

            return { screenDoc, content: respBodyFinal, isRrweb: false }
          })
      }

      return { screenDoc, content: undefined, isRrweb: false }
    })
    .then((payload) => {

      const resultResponse = {
        statusCode: ResponseCodes['200_OK'],
        headers: {
          'Access-Control-Max-Age': 600,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
          'Access-Control-Allow-Credentials': true,
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)

      if (payload.isRrweb) {
        res.send(JSON.stringify({
          screenDoc: payload.screenDoc,
          events: payload.events,
        }))
      } else {
        res.send(JSON.stringify({
          screenDoc: payload.screenDoc,
          content: payload.content,
        }))
      }
    })
    .catch((error) => {
      logger.error(error, { eventName: 'GET_SCREEN_PREVIEW_FAILED' })

      let resultResponse
      if (error.resultResponse) {
        resultResponse = error.resultResponse
      } else {
        resultResponse = {
          statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
            'Access-Control-Allow-Credentials': true,
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
