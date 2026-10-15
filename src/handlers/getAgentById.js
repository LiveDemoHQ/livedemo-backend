import helpers from '../helpers/livedemoHelpers.js'
import loadAgentInWorkspace from '../helpers/agent/loadAgentInWorkspace.js'
import { sendJson, sendError } from '../helpers/agent/http.js'

// GET /workspaces/:workspaceId/agents/:agentId — editor load
const handler = async function (req, res) {
  const { Models } = req.mongo
  const { workspaceId, agentId } = req.params

  try {
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, workspaceId)

    const agent = await loadAgentInWorkspace(Models, workspaceId, agentId)
    const payload = agent?.toJSON ? agent.toJSON() : agent

    // Share dropdown "Installed on" — latest embedded visit
    const lastEmbed = await Models.AgentSession.findOne({ agentId: agent._id, 'source.channel': 'embed' })
      .sort({ startTimestamp: -1 })
      .select('source.pageUrl startTimestamp')
      .lean()
    payload.embed = {
      ...(payload.embed || {}),
      lastSeen: lastEmbed ? { pageUrl: lastEmbed.source.pageUrl, at: lastEmbed.startTimestamp } : null,
    }

    sendJson(res, payload)
  } catch (error) {
    sendError(res, error)
  }
}

export default handler
