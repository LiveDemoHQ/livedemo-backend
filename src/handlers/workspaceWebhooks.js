import crypto from 'crypto'
import helpers from '../helpers/livedemoHelpers.js'
import ENV from '../envServer.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import WorkspaceTypes from '../constants/WorkspaceTypes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import { assertPublicUrl } from '../helpers/agent/publicUrl.js'
import { seal } from '../helpers/secretBox.js'
import { EVENTS, SLACK_URL_RE, ANALYTICS_URLS, analyticsPurpose, deliverWebhook } from '../helpers/workspaceEvents.js'

// /workspaces/:workspaceId/webhooks — outbound webhooks, Slack incoming webhooks and
// server-side GA4 / Segment (Growth plan). The webhook signing secret is returned in full
// only by create; lists mask it. GA4 api secrets / Segment write keys are write-only.

const MAX_HOOKS = 10
const KINDS = ['webhook', 'slack', 'ga4', 'segment']

const mask = secret => (secret ? `${secret.slice(0, 6)}…${secret.slice(-4)}` : '')

function displayUrl(hook) {
    if (hook.kind === 'slack') return hook.url.replace(/[^/]{6}$/, '******')
    if (hook.kind === 'ga4') return `Google Analytics 4 · ${hook.measurementId}`
    if (hook.kind === 'segment') return 'Segment HTTP Tracking API'
    return hook.url
}

const publicHook = (hook, { revealSecret } = {}) => ({
    _id: hook._id,
    kind: hook.kind,
    url: displayUrl(hook),
    secret: hook.kind !== 'webhook' ? '' : revealSecret ? hook.secret : mask(hook.secret),
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

// { url, secret, measurementId } for a new hook of this kind
async function hookTarget(kind, body, workspaceId) {
    if (kind === 'ga4') {

        const measurementId = String(body.measurementId || '').trim().toUpperCase()
        const apiSecret = String(body.apiSecret || '').trim()
        if (!/^G-[A-Z0-9]{4,15}$/.test(measurementId)) httpError(ResponseCodes['400_BAD_REQUEST'], 'Measurement ID must look like G-XXXXXXX')
        if (!/^[A-Za-z0-9_-]{10,64}$/.test(apiSecret)) httpError(ResponseCodes['400_BAD_REQUEST'], 'That does not look like a Measurement Protocol API secret')
        return { url: ANALYTICS_URLS.ga4, measurementId, secret: seal(apiSecret, analyticsPurpose(kind), workspaceId) }
    }
    if (kind === 'segment') {

        const writeKey = String(body.writeKey || '').trim()
        if (!/^[A-Za-z0-9]{20,64}$/.test(writeKey)) httpError(ResponseCodes['400_BAD_REQUEST'], 'That does not look like a Segment write key')
        return { url: ANALYTICS_URLS.segment, secret: seal(writeKey, analyticsPurpose(kind), workspaceId) }
    }
    return {
        url: await parseUrl(kind, body.url),
        secret: kind === 'webhook' ? `whsec_${crypto.randomBytes(24).toString('hex')}` : ''
    }
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
    const kind = KINDS.includes(body.kind) ? body.kind : 'webhook'
    const { workspaceId } = req.params
    if (ANALYTICS_URLS[kind]) {

        const workspace = await Models.Workspace.findById(workspaceId).select('type').lean()
        if (!workspace || workspace.type !== WorkspaceTypes.GROWTH) httpError(ResponseCodes['403_FORBIDDEN'], 'Server-side analytics is available on the Growth plan')
    }
    const count = await Models.WorkspaceWebhook.countDocuments({ workspaceId })
    if (count >= MAX_HOOKS) httpError(ResponseCodes['400_BAD_REQUEST'], `Up to ${MAX_HOOKS} webhooks per workspace`)

    const hook = await new Models.WorkspaceWebhook({
        workspaceId,
        kind,
        ...(await hookTarget(kind, body, workspaceId)),
        events: parseEvents(body.events),
        enabled: true
    }).save()
    sendJson(res, publicHook(hook.toObject(), { revealSecret: true }))
})

const update = wrap(async (req, res) => {
    const Models = await auth(req)
    const body = req.body || {}
    const hook = await loadHook(Models, req)
    if (body.url !== undefined && !ANALYTICS_URLS[hook.kind]) hook.url = await parseUrl(hook.kind, body.url)
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
