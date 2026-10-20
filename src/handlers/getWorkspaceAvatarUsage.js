import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import { usageSummary } from '../helpers/agent/avatarMinutes.js'

// GET /workspaces/:workspaceId/avatar-usage — minutes used this month and the subscription caps.
const handler = async function (req, res) {
    const { Models } = req.mongo
    res.set('Cache-Control', 'no-store')

    try {
        const { authUser } = await helpers.authReq(req, Models)
        helpers.validateUserHasAccessToWorkspace(authUser, req.params.workspaceId)
        const workspace = await Models.Workspace.findById(req.params.workspaceId).select('_id').lean()
        if (!workspace) httpError(ResponseCodes['404_NOT_FOUND'], 'Workspace not found')
        sendJson(res, await usageSummary(Models, workspace._id))
    } catch (error) {
        sendError(res, error)
    }
}

export default handler
