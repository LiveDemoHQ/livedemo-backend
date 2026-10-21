import helpers from '../helpers/livedemoHelpers.js'
import loadAgentInWorkspace from '../helpers/agent/loadAgentInWorkspace.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import ResponseCodes from '../constants/ResponseCodes.js'

// POST /workspaces/:workspaceId/agents/:agentId/publish  { isPublished }
// Copy of postStoryPublish. Not revision-captured (same as stories).
const handler = async function (req, res) {
  const { Models } = req.mongo
  const { workspaceId, agentId } = req.params

  try {
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, workspaceId)

    await loadAgentInWorkspace(Models, workspaceId, agentId)

    const isPublished = !!(req.body && req.body.isPublished)
    // A claimed template can land in a workspace without the plan; unpublishing stays allowed
    if (isPublished && !(authUser.featureFlags && authUser.featureFlags.allowAIAgents)) {
      httpError(ResponseCodes['403_FORBIDDEN'], 'Upgrade your plan to publish AI Demo Agents')
    }

    const updated = await Models.AiDemoAgent.findOneAndUpdate(
      { _id: agentId },
      { $set: { isPublished } },
      { new: true }
    )

    sendJson(res, updated)
  } catch (error) {
    sendError(res, error)
  }
}

export default handler
