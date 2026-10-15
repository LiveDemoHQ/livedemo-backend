import crypto from 'crypto'
import helpers from '../helpers/livedemoHelpers.js'
import ENV from '../envServer.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import { assertPublicUrl } from '../helpers/agent/publicUrl.js'
import { EVENTS, SLACK_URL_RE, deliverWebhook } from '../helpers/workspaceEvents.js'

// /workspaces/:workspaceId/webhooks — outbound webhooks + Slack incoming webhooks.
// The signing secret is returned in full only by create; lists mask it.

const MAX_HOOKS = 10

const mask = secret => (secret ? `${secret.slice(0, 6)}…${secret.slice(-4)}` : '')

const publicHook = (hook, { revealSecret } = {}) => ({
    _id: hook._id,
    kind: hook.kind,
    url: hook.kind === 'slack' ? hook.url.replace(/[^/]{6}$/, '******') : hook.url,
    secret: revealSecret ? hook.secret : mask(hook.secret),
    events: hook.events,
    enabled: hook.enabled,
    lastStatus: hook.lastStatus || null,
    lastError: hook.lastError || '',
    lastDeliveredAt: hook.lastDeliveredAt || null,
    createdAt: hook.createdAt
})

function parseEvents(raw) {
    if (raw === undefined) return [...EVENTS]
    if (!Array.isArray(raw) || !raw.length || raw.some(e => !EVENTS.includes(e))) {
        httpError(ResponseCodes['400_BAD_REQUEST'], `events must be a non-empty list of: ${EVENTS.join(', ')}`)
    }
    return [...new Set(raw)]
}

async function parseUrl(kind, raw) {
    const url = String(raw || '').trim()
    if (kind === 'slack') {
        if (!SLACK_URL_RE.test(url)) httpError(ResponseCodes['400_BAD_REQUEST'], 'Slack URL must look like https://hooks.slack.com/services/…')
        return url
    }
    const parsed = await assertPublicUrl(url, { httpsOnly: ENV.ENV !== 'dev' })
        .catch(err => httpError(ResponseCodes['400_BAD_REQUEST'], err.message))
    return parsed.toString()
}

async function auth(req) {
    const { Models } = req.mongo
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, req.params.workspaceId)
    return Models
}

async function loadHook(Models, req) {
    const hook = await Models.WorkspaceWebhook.findOne({ _id: req.params.webhookId, workspaceId: req.params.workspaceId })
    if (!hook) httpError(ResponseCodes['404_NOT_FOUND'], 'Webhook not found')
    return hook
}

const wrap = fn => (req, res) => fn(req, res).catch(error => sendError(res, error))

const list = wrap(async (req, res) => {
    const Models = await auth(req)
    const hooks = await Models.WorkspaceWebhook.find({ workspaceId: req.params.workspaceId }).sort({ createdAt: 1 }).lean()
    sendJson(res, hooks.map(hook => publicHook(hook)))
})

const create = wrap(async (req, res) => {
    const Models = await auth(req)
    const body = req.body || {}
    const kind = body.kind === 'slack' ? 'slack' : 'webhook'
    const count = await Models.WorkspaceWebhook.countDocuments({ workspaceId: req.params.workspaceId })
    if (count >= MAX_HOOKS) httpError(ResponseCodes['400_BAD_REQUEST'], `Up to ${MAX_HOOKS} webhooks per workspace`)

    const hook = await new Models.WorkspaceWebhook({
        workspaceId: req.params.workspaceId,
        kind,
        url: await parseUrl(kind, body.url),
        secret: kind === 'webhook' ? `whsec_${crypto.randomBytes(24).toString('hex')}` : '',
        events: parseEvents(body.events),
        enabled: true
    }).save()
    sendJson(res, publicHook(hook.toObject(), { revealSecret: true }))
})

const update = wrap(async (req, res) => {
    const Models = await auth(req)
    const body = req.body || {}
    const hook = await loadHook(Models, req)
    if (body.url !== undefined) hook.url = await parseUrl(hook.kind, body.url)
    if (body.events !== undefined) hook.events = parseEvents(body.events)
    if (body.enabled !== undefined) hook.enabled = !!body.enabled
    await hook.save()
    sendJson(res, publicHook(hook.toObject()))
})

const remove = wrap(async (req, res) => {
    const Models = await auth(req)
    const hook = await loadHook(Models, req)
    await hook.deleteOne()
    sendJson(res, { _id: hook._id })
})

// Sends one sample event right now (no retries) and reports the result
const test = wrap(async (req, res) => {
    const Models = await auth(req)
    const hook = await loadHook(Models, req)
    const event = {
        id: `evt_test_${crypto.randomBytes(8).toString('hex')}`,
        type: 'lead.qualified',
        createdAt: new Date().toISOString(),
        workspaceId: String(hook.workspaceId),
        test: true,
        data: {
            session: {
                id: 'test',
                agentName: 'Test agent',
                summary: 'This is a test event from LiveDemo.',
                intent: 'high',
                qualified: true,
                fields: { company: 'Acme', team_size: 50 },
                demosOpened: 1
            },
            lead: { id: 'test', name: 'Jane Doe', email: 'jane@acme.com', capturedVia: 'chat' }
        }
    }
    try {
        const result = await deliverWebhook(Models, hook.toObject(), event)
        sendJson(res, { ok: true, status: result.status })
    } catch (err) {
        sendJson(res, { ok: false, error: String(err.message).slice(0, 300) })
    }
})

export default {
    list,
    create,
    update,
    remove,
    test
}
