import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'

const KINDS = {
    story: 'Story',
    recording: 'AutoRecording',
    agent: 'AiDemoAgent'
}

function cleanTagName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40)
}

function tagList(workspace) {
    return (workspace.tags || []).map((tag) => ({
        _id: String(tag._id),
        name: tag.name
    }))
}

async function loadWorkspace(req) {
    const { Models } = req.mongo
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, req.params.workspaceId)
    const workspace = await Models.Workspace.findById(req.params.workspaceId)
    if (!workspace) {

        httpError(ResponseCodes['404_NOT_FOUND'], 'Workspace not found')
    }
    return { Models, workspace }
}

export async function getWorkspaceTags(req, res) {
    try {

        const { workspace } = await loadWorkspace(req)
        sendJson(res, { tags: tagList(workspace) })
    } catch (error) {

        sendError(res, error)
    }
}

export async function postWorkspaceTag(req, res) {
    try {

        const { workspace } = await loadWorkspace(req)
        const name = cleanTagName(req.body && req.body.name)
        if (!name) {

            httpError(ResponseCodes['400_BAD_REQUEST'], 'Tag name is required')
        }
        const taken = (workspace.tags || []).some((tag) => String(tag.name).toLowerCase() === name.toLowerCase())
        if (taken) {

            httpError(ResponseCodes['400_BAD_REQUEST'], 'Tag already exists')
        }
        if (!Array.isArray(workspace.tags)) {

            workspace.tags = []
        }
        workspace.tags.push({ name })
        await workspace.save()
        sendJson(res, { tags: tagList(workspace) })
    } catch (error) {

        sendError(res, error)
    }
}

export async function deleteWorkspaceTag(req, res) {
    try {

        const { Models, workspace } = await loadWorkspace(req)
        const tagId = String(req.params.tagId)
        const tag = workspace.tags && workspace.tags.id(tagId)
        if (!tag) {

            httpError(ResponseCodes['404_NOT_FOUND'], 'Tag not found')
        }
        workspace.tags.pull(tag._id)
        await workspace.save()
        await Promise.all(Object.values(KINDS).map((modelName) => (
            Models[modelName].updateMany({ workspaceId: workspace._id }, { $pull: { tags: tagId } })
        )))
        sendJson(res, { tags: tagList(workspace) })
    } catch (error) {

        sendError(res, error)
    }
}

// { kind: 'story'|'recording'|'agent', ids: [], tagId, on }
export async function postWorkspaceTagAssign(req, res) {
    try {

        const { Models, workspace } = await loadWorkspace(req)
        const body = req.body || {}
        const modelName = KINDS[body.kind]
        const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : []
        const tagId = String(body.tagId || '')
        const known = (workspace.tags || []).some((tag) => String(tag._id) === tagId)
        if (!modelName || !ids.length || !known) {

            httpError(ResponseCodes['400_BAD_REQUEST'], 'Choose a tag and at least one item')
        }
        const op = body.on
            ? { $addToSet: { tags: tagId } }
            : { $pull: { tags: tagId } }
        await Models[modelName].updateMany({ _id: { $in: ids }, workspaceId: workspace._id }, op)
        sendJson(res, { ok: true })
    } catch (error) {

        sendError(res, error)
    }
}
