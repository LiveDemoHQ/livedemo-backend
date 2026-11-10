import helpers from '../helpers/livedemoHelpers.js'
import loadAgentInWorkspace from '../helpers/agent/loadAgentInWorkspace.js'
import { copyAgent } from '../helpers/agent/copyAgent.js'
import { sendJson, sendError } from '../helpers/agent/http.js'
import postAgentCopyValidator from '../helpers/validators/agents/postAgentCopyValidator.js'

// POST /workspaces/:workspaceId/agents/:agentId/copy  { name? }
// Same workspace. The copy is a draft; knowledge comes along (copyAgent.js).
const handler = async function (req, res) {
    const { Models } = req.mongo
    const { workspaceId, agentId } = req.params

    try {
        const { authUser } = await helpers.authReq(req, Models)
        helpers.validateUserHasAccessToWorkspace(authUser, workspaceId)

        const body = helpers.validateBody(req.body || {}, postAgentCopyValidator).value
        const agent = await loadAgentInWorkspace(Models, workspaceId, agentId)
        const source = agent.toObject ? agent.toObject() : agent
        const copy = await copyAgent(Models, source, { name: body.name, userId: authUser.id })

        sendJson(res, { _id: copy._id, name: copy.name })
    } catch (error) {
        sendError(res, error)
    }
}

export default handler
