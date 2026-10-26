import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { undoOnce, historyCounts } from '../helpers/agentRevisions.js'
import enqueueIndexAgentKnowledge from '../helpers/agent/enqueueIndexJob.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'

import logger from '../helpers/logger.js'

// POST /workspaces/:workspaceId/agents/:agentId/history/:revisionId/revert
// Undo every entry newer than the target, plus the target (copy postStoryRevert).
const handler = async function (req, res) {
  const { Models } = req.mongo
  const { workspaceId, agentId, revisionId } = req.params

  try {
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, workspaceId)

    const target = await Models.AgentRevision
      .findOne({ _id: revisionId, agentId, kind: 'undo' })
      .select('_id')
      .lean()
    if (!target) {
      httpError(ResponseCodes['404_NOT_FOUND'], 'Revision not found')
    }

    let remaining = await Models.AgentRevision.countDocuments({
      agentId, kind: 'undo', _id: { $gte: target._id },
    })
    let lastUndone = null
    while (remaining-- > 0) {
      const rev = await undoOnce(Models, { agentId, workspaceId })
      if (!rev) break
      lastUndone = rev.actionLabel
    }

    if (lastUndone !== null) {
      enqueueIndexAgentKnowledge(agentId).catch(err => logger.error('enqueue reindex failed', { eventName: 'ENQUEUE_REINDEX_FAILED', err: err }))
    }

    const counts = await historyCounts(Models, agentId)

    sendJson(res, { undone: lastUndone, ...counts })
  } catch (error) {
    sendError(res, error)
  }
}

export default handler
