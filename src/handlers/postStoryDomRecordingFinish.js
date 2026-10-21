import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import fsp from 'fs/promises'
import ENV from '../envServer.js'
import StoryStatuses from '../constants/StoryStatuses.js'
import flixHelpers from '../helpers/flixHelpers.js'

const SCREENDOC_ENCODING = 'utf-8'

async function readRecording(filePath) {
  try {
    const raw = await fsp.readFile(filePath, { encoding: SCREENDOC_ENCODING })
    return JSON.parse(raw)
  } catch (e) {
    return {
      version: '2.1.1',
      href: '',
      viewport: {},
      events: [],
      clickThumbnails: [],
    }
  }
}

const handler = function (req, res) {
  let { Models } = req.mongo
  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let authUserDoc = null

  return Promise.resolve()
    .then(() => helpers.authReq(req, Models))
    .then(({ authUser }) => {
      authUserDoc = authUser
      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
      return Models.Story.findOne({ _id: storyId, workspaceId, deletedAt: null }).lean()
    })
    .then(async (storyDoc) => {
      if (!storyDoc) {
        const error = new Error('Story not found')
        error.resultResponse = {
          statusCode: ResponseCodes['404_NOT_FOUND'],
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
          },
          body: JSON.stringify({ message: 'Story not found' }),
        }
        throw error
      }

      const events = Array.isArray(req.body.events) ? req.body.events : []
      const clickThumbnails = Array.isArray(req.body.clickThumbnails) ? req.body.clickThumbnails : []

      let filePath = storyDoc.filePath
      if (!filePath) {
        const dir = ENV.STORY_REQUESTS_FOLDER || ENV.STORIES_FOLDER
        try {
          await fsp.mkdir(dir, { recursive: true })
        } catch (e) {
          // ignore
        }
        filePath = `${dir}/${storyId}.dom.json`
      }

      const recording = await readRecording(filePath)
      if (!Array.isArray(recording.events)) recording.events = []
      if (!Array.isArray(recording.clickThumbnails)) recording.clickThumbnails = []

      if (events.length) {
        recording.events.push(...events)
      }
      if (clickThumbnails.length) {
        recording.clickThumbnails.push(...clickThumbnails)
      }
      if (req.body.viewport) {
        recording.viewport = req.body.viewport
      }
      if (req.body.href) {
        recording.href = req.body.href
      }
      if (storyDoc.rrweb && storyDoc.rrweb.version) {
        recording.version = storyDoc.rrweb.version
      }

      if (!recording.events.length) {
        const error = new Error('No rrweb events to process')
        error.resultResponse = {
          statusCode: ResponseCodes['400_BAD_REQUEST'],
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
          },
          body: JSON.stringify({ message: 'No rrweb events to process' }),
        }
        throw error
      }

      await helpers.writeToSystem(filePath, JSON.stringify(recording), SCREENDOC_ENCODING)

      await Models.Story.updateOne(
        { _id: storyId },
        {
          $set: {
            filePath,
            status: StoryStatuses.UPLOADING,
            screens: [],
          }
        }
      )

      await (storyDoc.mode === 'sandbox' ? flixHelpers.enqueueProcessSandboxDom(storyId) : flixHelpers.enqueueProcessStoryDemoDom(storyId))

      res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
      })
      res.status(ResponseCodes['200_OK'])
      res.send(JSON.stringify({
        ok: true,
        storyId,
        eventCount: recording.events.length,
        status: StoryStatuses.UPLOADING,
      }))
    })
    .catch((error) => {
      console.log(error)
      let resultResponse = error.resultResponse || {
        statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
        },
        body: '',
      }
      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body)
    })
}

export default handler
