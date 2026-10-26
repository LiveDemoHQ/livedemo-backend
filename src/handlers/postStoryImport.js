import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { importStoryDemo, importPayloadIssue } from '../helpers/importStoryDemo.js'
import postStoryImportValidator from '../helpers/validators/stories/postStoryImportValidator.js'

import logger from '../helpers/logger.js'

const CORS_HEADERS = {
  'Access-Control-Max-Age': 600,
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
  'Access-Control-Allow-Credentials': true,
}

// POST /workspaces/:workspaceId/stories/import { story, screens: [{ screenDoc, events, imageData? }] }
// Imports an exported story (e.g. livedemo-cursor output) as a new story in the workspace.
const handler = function (req, res) {
  const { Models } = req.mongo
  const workspaceId = req.params.workspaceId

  return Promise.resolve()
    .then(() => helpers.authReq(req, Models))
    .then(({ authUser }) => {
      helpers.validateUserHasAccessToWorkspace(authUser, workspaceId)
      return authUser
    })
    .then(async (authUser) => {
      const body = helpers.validateBody(req.body, postStoryImportValidator).value
      const issue = importPayloadIssue(body)
      if (issue) {
        const error = new Error(issue)
        error.resultResponse = {
          statusCode: ResponseCodes['400_BAD_REQUEST'],
          headers: CORS_HEADERS,
          body: JSON.stringify({ message: issue }),
        }
        throw error
      }

      const newStoryId = await importStoryDemo(Models, body, { workspaceId, userId: authUser._id })
      return Models.Story.findById(newStoryId)
        .populate({ path: 'screens', select: '_id type imageUrl' })
        .lean()
    })
    .then((story) => {
      res.set(CORS_HEADERS)
      res.status(ResponseCodes['200_OK'])
      res.send(JSON.stringify(story))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_STORY_IMPORT_FAILED' })

      const resultResponse = error.resultResponse || {
        statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
        headers: CORS_HEADERS,
        body: '',
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body)
    })
}

export default handler
