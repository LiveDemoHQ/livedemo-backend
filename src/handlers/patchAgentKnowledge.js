import helpers from '../helpers/livedemoHelpers.js'
import loadAgentInWorkspace from '../helpers/agent/loadAgentInWorkspace.js'
import enqueueIndexAgentKnowledge from '../helpers/agent/enqueueIndexJob.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import { assertPublicUrl } from '../helpers/agent/publicUrl.js'
import { MAX_PAGES_CAP } from '../helpers/agent/siteCrawler.js'

// PATCH /workspaces/:workspaceId/agents/:agentId/knowledge/:sourceId
// title / rawText / enabled. Content edits re-enqueue indexing.
const handler = async function (req, res) {
  const { Models } = req.mongo
  const { workspaceId, agentId, sourceId } = req.params
  const body = req.body || {}

  try {
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, workspaceId)

    await loadAgentInWorkspace(Models, workspaceId, agentId)

    const updates = {}
    if (body.title !== undefined) updates.title = body.title
    if (body.enabled !== undefined) updates.enabled = !!body.enabled
    if (body.rawText !== undefined) {
      updates.rawText = body.rawText
      updates.status = 'pending'
    }
    if (body.url !== undefined) {
      const url = await assertPublicUrl(body.url).catch(err => httpError(ResponseCodes['400_BAD_REQUEST'], err.message))
      updates.url = url.toString()
      updates.status = 'pending'
    }
    if (body.refreshHours !== undefined) {
      const hours = Number(body.refreshHours)
      if (!Number.isInteger(hours) || hours < 0 || hours > 24 * 30) httpError(ResponseCodes['400_BAD_REQUEST'], 'refreshHours must be 0-720')
      updates.refreshHours = hours
    }
    if (body.maxPages !== undefined) {
      const maxPages = Number(body.maxPages)
      if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES_CAP) httpError(ResponseCodes['400_BAD_REQUEST'], `maxPages must be 1-${MAX_PAGES_CAP}`)
      updates.maxPages = maxPages
    }

    const source = await Models.AgentKnowledgeSource.findOneAndUpdate(
      { _id: sourceId, agentId, workspaceId },
      { $set: updates },
      { new: true }
    )

    if (!source) {
      httpError(ResponseCodes['404_NOT_FOUND'], 'Knowledge source not found')
    }

    if (updates.status === 'pending') {
      enqueueIndexAgentKnowledge(agentId, sourceId)
        .catch(err => console.log('enqueue indexAgentKnowledge failed', err))
    }

    sendJson(res, source)
  } catch (error) {
    sendError(res, error)
  }
}

export default handler
