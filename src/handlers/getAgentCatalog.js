import helpers from '../helpers/livedemoHelpers.js'
import { sendJson, sendError } from '../helpers/agent/http.js'
import { AGENT_TEMPLATES } from '../helpers/agent/agentTemplates.js'
import { flowCatalog } from '../helpers/agent/goalFlows.js'

// GET /workspaces/:workspaceId/agent-catalog
// Templates for the "new agent" picker + goal flows (stages, diagram edges, presets) for the Goal tab.
const handler = async function (req, res) {
  const { Models } = req.mongo

  try {
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, req.params.workspaceId)

    sendJson(res, {
      templates: AGENT_TEMPLATES.map(({ config, ...t }) => ({ ...t, flow: config.goal.flow, intensity: config.goal.intensity })),
      ...flowCatalog(),
    })
  } catch (error) {
    sendError(res, error)
  }
}

export default handler
