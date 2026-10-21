import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import { normalizeLink, normalizeFlows, isObjectId, SETTINGS } from '../helpers/sandbox/sandbox.js'

// Sandbox editor API (see SANDBOX_STORYDEMOS_IMPLEMENTATION.md §4.5). Base path:
// /workspaces/:workspaceId/stories/:storyId/sandbox
// PATCH  /                                   settings, startScreenId, flows
// GET    /links                              { flowUsage, diagnostics }
// POST   /screens/:screenId/links            link create
// PATCH  /screens/:screenId/links/:linkId    link update
// DELETE /screens/:screenId/links/:linkId    link delete
// POST   /screens/:screenId/merge            { intoScreenId } revisit dedupe
// DELETE /screens/:screenId                  sandbox screen delete
// Revisions come from the rev() middleware on each route.

const wrap = fn => (req, res) => fn(req, res).catch(error => sendError(res, error))

function notFound(what) {
    httpError(ResponseCodes['404_NOT_FOUND'], `${what} not found`)
}

async function loadSandbox(req) {
    const { Models } = req.mongo
    const { workspaceId, storyId } = req.params
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, workspaceId)
    if (!isObjectId(storyId)) notFound('Sandbox')
    const story = await Models.Story.findOne({ _id: storyId, workspaceId, mode: 'sandbox', deletedAt: null }).lean()
    if (!story) notFound('Sandbox')
    const screens = await Models.Screen.find({ storyId }).select('_id name index recordingRole baseScreenId sandboxLinks sandboxHidden sandboxDuplicateOf').lean()
    return {
        Models,
        story,
        screens,
        ctx: {
            screenIds: new Set(screens.map(s => String(s._id))),
            flows: (story.sandbox && story.sandbox.flows) || []
        }
    }
}

function screenOf(screens, screenId) {
    const screen = screens.find(s => String(s._id) === String(screenId))
    if (!screen) notFound('Screen')
    return screen
}

const patchSandbox = wrap(async (req, res) => {
    const { Models, story, ctx } = await loadSandbox(req)
    const body = req.body || {}
    const updates = {}

    SETTINGS.forEach((key) => {
        if (body[key] === undefined) return
        if (typeof body[key] !== 'boolean') httpError(ResponseCodes['400_BAD_REQUEST'], `${key} must be true or false`)
        updates[`sandbox.${key}`] = body[key]
    })
    if (body.startScreenId !== undefined) {

        if (!ctx.screenIds.has(String(body.startScreenId))) httpError(ResponseCodes['400_BAD_REQUEST'], 'startScreenId must be a screen of this sandbox')
        updates['sandbox.startScreenId'] = String(body.startScreenId)
    }
    if (body.flows !== undefined) {

        updates['sandbox.flows'] = normalizeFlows(body.flows, { screenIds: ctx.screenIds, currentFlows: ctx.flows })
    }

    const updated = await Models.Story.findOneAndUpdate({ _id: story._id }, { $set: updates }, { new: true }).select('sandbox').lean()
    sendJson(res, updated.sandbox)
})

const getLinks = wrap(async (req, res) => {
    const { Models, story, screens, ctx } = await loadSandbox(req)
    const visible = screens.filter(s => !s.sandboxHidden && !s.sandboxDuplicateOf)
    const visibleIds = new Set(visible.map(s => String(s._id)))
    const flowStart = id => (ctx.flows.find(f => String(f._id) === String(id)) || {}).startScreenId
    const targetOf = link => String(link.gotoType === 'flow' ? (flowStart(link.gotoFlowId) || link.gotoScreen) : link.gotoScreen)

    const dangling = []
    const edges = {}
    visible.forEach((screen) => {
        edges[screen._id] = []
        ;(screen.sandboxLinks || []).forEach((link) => {
            if (link.gotoType === 'website') return
            const target = targetOf(link)
            if (visibleIds.has(target)) edges[screen._id].push(target)
            else dangling.push({ screenId: String(screen._id), linkId: String(link._id) })
        })
    })

    // Every flow start is an entry point (Showcase items open flows directly)
    const roots = [story.sandbox && story.sandbox.startScreenId, ...ctx.flows.map(f => f.startScreenId)].filter(Boolean).map(String)
    const seen = new Set()
    const queue = roots.filter(id => visibleIds.has(id))
    while (queue.length) {
        const id = queue.shift()
        if (seen.has(id)) continue
        seen.add(id)
        queue.push(...(edges[id] || []))
    }

    const showcases = await Models.Showcase.find({ workspaceId: story.workspaceId, deletedAt: null, 'items.storyId': String(story._id) }).select('name items.storyId items.flowId').lean()
    const flowUsage = {}
    showcases.forEach((showcase) => {
        const flowIds = new Set(showcase.items.filter(item => String(item.storyId) === String(story._id)).map(item => item.flowId || ''))
        flowIds.forEach((flowId) => {
            flowUsage[flowId] = (flowUsage[flowId] || 0) + 1
        })
    })

    sendJson(res, {
        flowUsage,
        diagnostics: {
            dangling,
            deadEnds: visible.filter(s => !(s.sandboxLinks || []).length).map(s => String(s._id)),
            unreachable: visible.filter(s => !seen.has(String(s._id))).map(s => String(s._id)),
            flowsWithoutGoal: ctx.flows.filter(f => !f.completion || f.completion.type === 'none').map(f => String(f._id))
        }
    })
})

const postLink = wrap(async (req, res) => {
    const { Models, screens, ctx } = await loadSandbox(req)
    const screen = screenOf(screens, req.params.screenId)
    if ((screen.sandboxLinks || []).length >= 100) httpError(ResponseCodes['400_BAD_REQUEST'], 'Up to 100 links per screen')
    const link = normalizeLink(req.body, ctx)
    const updated = await Models.Screen_Page.findOneAndUpdate({ _id: screen._id }, { $push: { sandboxLinks: link } }, { new: true }).select('sandboxLinks').lean()
    sendJson(res, updated.sandboxLinks[updated.sandboxLinks.length - 1])
})

const patchLink = wrap(async (req, res) => {
    const { Models, screens, ctx } = await loadSandbox(req)
    const screen = screenOf(screens, req.params.screenId)
    const existing = (screen.sandboxLinks || []).find(l => String(l._id) === req.params.linkId)
    if (!existing) notFound('Link')
    const link = { ...normalizeLink(req.body, ctx, existing), _id: existing._id, syncGroupId: existing.syncGroupId }
    const updated = await Models.Screen_Page.findOneAndUpdate(
        { _id: screen._id },
        { $set: { 'sandboxLinks.$[l]': link } },
        {
            new: true,
            arrayFilters: [{ 'l._id': existing._id }]
        }
    ).select('sandboxLinks').lean()
    sendJson(res, updated.sandboxLinks.find(l => String(l._id) === req.params.linkId))
})

const deleteLink = wrap(async (req, res) => {
    const { Models, screens } = await loadSandbox(req)
    const screen = screenOf(screens, req.params.screenId)
    if (!isObjectId(req.params.linkId)) notFound('Link')
    await Models.Screen_Page.updateOne({ _id: screen._id }, { $pull: { sandboxLinks: { _id: req.params.linkId } } })
    sendJson(res, { ok: true })
})

// Flow / start references: replace (merge) or drop (delete) one screen id
function remapFlows(sandbox, fromId, toId) {
    const swap = ids => [...new Set((ids || []).map(String).map(id => (id === fromId ? toId : id)).filter(Boolean))]
    const flows = (sandbox.flows || []).map((flow) => {
        const screenIds = swap(flow.screenIds)
        const start = String(flow.startScreenId) === fromId ? (toId || screenIds[0] || null) : flow.startScreenId
        return { ...flow, screenIds, startScreenId: start, completion: { ...flow.completion, screenIds: swap(flow.completion && flow.completion.screenIds) } }
    })
    const start = String(sandbox.startScreenId) === fromId ? (toId || (flows[0] && flows[0].startScreenId) || null) : sandbox.startScreenId
    return { flows, startScreenId: start }
}

const mergeScreen = wrap(async (req, res) => {
    const { Models, story, screens } = await loadSandbox(req)
    const from = screenOf(screens, req.params.screenId)
    const into = screenOf(screens, (req.body || {}).intoScreenId)
    if (String(from._id) === String(into._id) || into.sandboxDuplicateOf) httpError(ResponseCodes['400_BAD_REQUEST'], 'Pick another screen to merge into')
    const fromId = String(from._id)
    const intoId = String(into._id)

    // Incoming links now land on the kept screen
    await Models.Screen_Page.updateMany(
        { storyId: story._id, 'sandboxLinks.gotoScreen': from._id },
        { $set: { 'sandboxLinks.$[l].gotoScreen': into._id } },
        { arrayFilters: [{ 'l.gotoScreen': from._id }] }
    )
    // Its outgoing links move over too, or the screens after the revisit become unreachable.
    // rrweb node ids only hold within one chain.
    const chainOf = s => String(s.recordingRole === 'base' ? s._id : s.baseScreenId)
    const sameChain = chainOf(from) === chainOf(into)
    const targets = new Set((into.sandboxLinks || []).map(l => String(l.gotoScreen)))
    const moved = (from.sandboxLinks || [])
        .filter(l => String(l.gotoScreen) !== intoId && !targets.has(String(l.gotoScreen)))
        .map(({ _id, ...link }) => ({ ...link, anchor: { ...link.anchor, rrwebNodeId: sameChain ? link.anchor.rrwebNodeId : null } }))
    if (moved.length) await Models.Screen_Page.updateOne({ _id: into._id }, { $push: { sandboxLinks: { $each: moved } } })
    // Never delete: later deltas of its chain replay through it
    await Models.Screen_Page.updateOne({ _id: from._id }, { $set: { sandboxDuplicateOf: into._id, sandboxHidden: true } })

    const { flows, startScreenId } = remapFlows(story.sandbox || {}, fromId, intoId)
    await Models.Story.updateOne({ _id: story._id }, { $set: { 'sandbox.flows': flows, 'sandbox.startScreenId': startScreenId } })
    sendJson(res, { ok: true })
})

const deleteScreen = wrap(async (req, res) => {
    const { Models, story, screens } = await loadSandbox(req)
    const screen = screenOf(screens, req.params.screenId)

    await Models.Screen_Page.updateMany({ storyId: story._id }, { $pull: { sandboxLinks: { gotoScreen: screen._id } } })
    const { flows, startScreenId } = remapFlows(story.sandbox || {}, String(screen._id), null)
    await Models.Story.updateOne({ _id: story._id }, { $set: { 'sandbox.flows': flows, 'sandbox.startScreenId': startScreenId } })

    const replayedThrough = screen.recordingRole === 'base' && screens.some(s => String(s.baseScreenId) === String(screen._id))
    if (replayedThrough) {

        await Models.Screen_Page.updateOne({ _id: screen._id }, { $set: { sandboxHidden: true } })
    } else {

        await Models.Screen.deleteOne({ _id: screen._id })
        await Models.Story.updateOne({ _id: story._id }, { $pull: { screens: screen._id } })
    }
    sendJson(res, { ok: true, hidden: replayedThrough })
})

export default {
    patchSandbox,
    getLinks,
    postLink,
    patchLink,
    deleteLink,
    mergeScreen,
    deleteScreen
}
