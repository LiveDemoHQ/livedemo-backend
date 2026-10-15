import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import {
    PROVIDERS,
    canUseCustomKeys,
    isValidKeyFormat,
    sealKey,
    publicKeyStatus,
    verifyKey
} from '../helpers/agent/providerKeys.js'

// GET    /workspaces/:workspaceId/provider-keys             status only (members)
// PUT    /workspaces/:workspaceId/provider-keys/:provider   { apiKey } (workspace admin, Growth plan)
// DELETE /workspaces/:workspaceId/provider-keys/:provider   (workspace admin)
// Keys are write-only: no response, log line or error message ever contains one.

async function load(req) {
    const Models = req.mongo.Models
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, req.params.workspaceId)
    const workspace = await Models.Workspace.findById(req.params.workspaceId).select('type adminUser +providerKeys').lean()
    if (!workspace) httpError(ResponseCodes['404_NOT_FOUND'], 'Workspace not found')
    const isAdmin = !!workspace.adminUser && String(workspace.adminUser) === String(authUser._id)
    return { Models, authUser, workspace, isAdmin }
}

function assertAdminProvider(req, isAdmin) {
    if (!isAdmin) httpError(ResponseCodes['403_FORBIDDEN'], 'Only the workspace admin can manage API keys')
    if (!PROVIDERS[req.params.provider]) httpError(ResponseCodes['404_NOT_FOUND'], 'Unknown provider')
}

const status = (workspace, isAdmin) => ({
    eligible: canUseCustomKeys(workspace),
    isAdmin,
    keys: publicKeyStatus(workspace)
})

const wrap = fn => (req, res) => {
    res.set('Cache-Control', 'no-store')
    return fn(req, res).catch(error => sendError(res, error))
}

const get = wrap(async (req, res) => {
    const { workspace, isAdmin } = await load(req)
    sendJson(res, status(workspace, isAdmin))
})

const put = wrap(async (req, res) => {
    const { Models, authUser, workspace, isAdmin } = await load(req)
    assertAdminProvider(req, isAdmin)
    if (!canUseCustomKeys(workspace)) httpError(ResponseCodes['403_FORBIDDEN'], 'Custom API keys are available on the Growth plan')

    const { provider } = req.params
    const apiKey = String((req.body && req.body.apiKey) || '').trim()
    if (!isValidKeyFormat(apiKey)) httpError(ResponseCodes['400_BAD_REQUEST'], 'That does not look like an API key')
    const verified = await verifyKey(provider, apiKey)
    if (verified === false) httpError(ResponseCodes['400_BAD_REQUEST'], `${PROVIDERS[provider].label} rejected this API key`)

    const entry = { enc: sealKey(provider, apiKey, workspace._id), updatedAt: new Date(), updatedBy: authUser._id }
    await Models.Workspace.updateOne({ _id: workspace._id }, { $set: { [`providerKeys.${provider}`]: entry } })
    sendJson(res, status({ ...workspace, providerKeys: { ...workspace.providerKeys, [provider]: entry } }, isAdmin))
})

const remove = wrap(async (req, res) => {
    const { Models, workspace, isAdmin } = await load(req)
    assertAdminProvider(req, isAdmin)
    const { provider } = req.params
    await Models.Workspace.updateOne({ _id: workspace._id }, { $unset: { [`providerKeys.${provider}`]: '' } })
    const providerKeys = { ...workspace.providerKeys }
    delete providerKeys[provider]
    sendJson(res, status({ ...workspace, providerKeys }, isAdmin))
})

export default {
    get,
    put,
    remove
}
