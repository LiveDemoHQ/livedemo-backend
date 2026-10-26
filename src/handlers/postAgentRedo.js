import helpers from '../helpers/livedemoHelpers.js'
import { redoOnce, historyCounts } from '../helpers/agentRevisions.js'
import enqueueIndexAgentKnowledge from '../helpers/agent/enqueueIndexJob.js'
import { sendJson, sendError } from '../helpers/agent/http.js'

import logger from '../helpers/logger.js'

// POST /workspaces/:workspaceId/agents/:agentId/redo
const handler = async function (req, res) {
  const { Models } = req.mongo
  const { workspaceId, agentId } = req.params

  try {
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, workspaceId)

    const rev = await redoOnce(Models, { agentId, workspaceId })
    const counts = await historyCounts(Models, agentId)

    if (rev) {
      enqueueIndexAgentKnowledge(agentId).catch(err => logger.error('enqueue reindex failed', { eventName: 'ENQUEUE_REINDEX_FAILED', err: err }))
    }

    sendJson(res, { redone: rev ? rev.actionLabel : null, ...counts })
  } catch (error) {
    sendError(res, error)
  }
}

export default handler
