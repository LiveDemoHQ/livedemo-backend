import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { httpError } from '../helpers/rrwebScreenGuards.js'
import { undoOnce, historyCounts } from '../helpers/storyRevisions.js'

import logger from '../helpers/logger.js'

// "Restore to this point in history" = undo every entry newer than the target,
// plus the target itself. LIFO over pre-images makes that exactly equivalent to
// a point-in-time restore of everything captured.
const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let revisionId = req.params.revisionId
  let authUserDoc = null

  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser
      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(async () => {
      const target = await Models.StoryRevision
        .findOne({ _id: revisionId, storyId, kind: 'undo' })
        .select('_id')
        .lean()
      if (!target) {
        httpError(ResponseCodes['404_NOT_FOUND'], 'Revision not found')
      }

      // Every entry newer than the target, plus the target itself
      let remaining = await Models.StoryRevision.countDocuments({
        storyId, kind: 'undo', _id: { $gte: target._id }
      })
      let lastUndone = null
      while (remaining-- > 0) {
        const rev = await undoOnce(Models, { storyId, workspaceId })
        if (!rev) break
        lastUndone = rev.actionLabel
      }

      const counts = await historyCounts(Models, storyId)

      return { undone: lastUndone, ...counts }
    })
    .then((result) => {

      const resultResponse = {
        statusCode: ResponseCodes['200_OK'],
        headers: {
          'Access-Control-Max-Age': 600,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
          'Access-Control-Allow-Credentials': true,
        },
        body: JSON.stringify(result)
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body)
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_STORY_REVERT_FAILED' })

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

export default handler
