import mongoose from 'mongoose'
import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import { renderSummaryEmail, unsubscribeUrlFor, buildMime, isValidEmail, PLACEHOLDERS, DEFAULT_SUBJECT, DEFAULT_BODY } from '../helpers/agent/summaryEmail.js'
import { normalizeEmailSettings, publicEmailSettings, emailSettingsOf, senderFor, deliver } from '../helpers/agent/emailSending.js'

// Summary emails sent to agent visitors.
// GET  /workspaces/:workspaceId/agent-emails?agentId=&sessionId=&leadId=   sent history (auth)
// POST /workspaces/:workspaceId/agents/:agentId/summary-email/preview     render a template with sample data (auth)
// GET  /workspaces/:workspaceId/email-settings        sender for visitor emails (auth)
// PUT  /workspaces/:workspaceId/email-settings        { mode, smtp } (auth)
// POST /workspaces/:workspaceId/email-settings/test   send a test email to the signed-in user (auth)
// GET  /agent-emails/unsubscribe/:token   confirm page (a button, so link scanners don't unsubscribe people)
// POST /agent-emails/unsubscribe/:token   unsubscribe; also the RFC 8058 one-click target

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/
const isId = id => mongoose.Types.ObjectId.isValid(String(id || ''))

async function authWithUser(req) {
    const Models = req.mongo.Models
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, req.params.workspaceId)
    return { Models, authUser }
}

const auth = req => authWithUser(req).then(({ Models }) => Models)

const wrap = fn => (req, res) => fn(req, res).catch(error => sendError(res, error))

const list = wrap(async (req, res) => {
    const Models = await auth(req)
    const query = { workspaceId: req.params.workspaceId }
    for (const key of ['agentId', 'sessionId', 'leadId']) {
        if (req.query[key] === undefined) continue
        if (!isId(req.query[key])) httpError(ResponseCodes['400_BAD_REQUEST'], `Invalid ${key}`)
        query[key] = req.query[key]
    }
    const emails = await Models.AgentEmail.find(query)
        .sort({ createdAt: -1 })
        .limit(100)
        .select('-unsubscribeToken -text')
        .lean()
    sendJson(res, emails)
})

const preview = wrap(async (req, res) => {
    const Models = await auth(req)
    const agent = await Models.AiDemoAgent.findOne({ _id: req.params.agentId, workspaceId: req.params.workspaceId, deletedAt: null }).lean()
    if (!agent) httpError(ResponseCodes['404_NOT_FOUND'], 'Agent not found')
    const body = req.body || {}
    const draft = {
        ...agent,
        summaryEmail: {
            subject: String(body.subject || '').slice(0, 200),
            body: String(body.body || '').slice(0, 5000)
        }
    }
    const vars = {
        firstName: 'Alex',
        name: 'Alex Smith',
        agentName: agent.name || 'our demo agent',
        summary: 'You asked how onboarding works for a 50-person team and how pricing scales. We walked through the admin setup and SSO.',
        topics: 'Onboarding, Pricing, SSO',
        demos: 'Admin setup, SSO walkthrough',
        recapUrl: agent.recapEnabled === false ? '' : 'https://api.livedemo.ai/recaps/example',
        bookingUrl: (agent.cta && agent.cta.bookMeetingUrl) || ''
    }
    sendJson(res, {
        ...renderSummaryEmail({ agent: draft, vars, unsubscribeUrl: unsubscribeUrlFor('preview') }),
        placeholders: PLACEHOLDERS,
        defaultSubject: DEFAULT_SUBJECT,
        defaultBody: DEFAULT_BODY
    })
})

const loadWorkspace = async (Models, workspaceId) => {
    const workspace = await Models.Workspace.findById(workspaceId).select('+summaryEmailSending').lean()
    if (!workspace) httpError(ResponseCodes['404_NOT_FOUND'], 'Workspace not found')
    return workspace
}

const getSettings = wrap(async (req, res) => {
    const Models = await auth(req)
    sendJson(res, publicEmailSettings(await loadWorkspace(Models, req.params.workspaceId)))
})

const putSettings = wrap(async (req, res) => {
    const Models = await auth(req)
    const workspace = await loadWorkspace(Models, req.params.workspaceId)
    let summaryEmailSending
    try {
        summaryEmailSending = normalizeEmailSettings(req.body || {}, workspace)
    } catch (err) {
        if (!err.isValidation) throw err
        httpError(ResponseCodes['400_BAD_REQUEST'], err.message)
    }
    await Models.Workspace.updateOne({ _id: workspace._id }, { $set: { summaryEmailSending } })
    sendJson(res, publicEmailSettings({ summaryEmailSending }))
})

const testSettings = wrap(async (req, res) => {
    const { Models, authUser } = await authWithUser(req)
    const settings = emailSettingsOf(await loadWorkspace(Models, req.params.workspaceId))
    const from = senderFor(settings, 'Test agent')
    if (!from) httpError(ResponseCodes['400_BAD_REQUEST'], 'Email sending is disabled')
    const to = String(authUser.email || '').toLowerCase()
    if (!isValidEmail(to)) httpError(ResponseCodes['400_BAD_REQUEST'], 'Your account has no valid email')
    const text = 'This is a test from LiveDemo. Session summary emails will be sent with these settings.'
    try {
        await deliver(settings, {
            to,
            mime: buildMime({
                from,
                to,
                subject: 'LiveDemo test email',
                html: `<p>${text}</p>`,
                text,
                unsubscribeUrl: unsubscribeUrlFor('test')
            })
        })
    } catch (err) {
        httpError(ResponseCodes['400_BAD_REQUEST'], `Sending failed: ${String(err.message || err).slice(0, 300)}`)
    }
    sendJson(res, { ok: true, to })
})

function page(res, status, message, form) {
    res.status(status)
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' })
    res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unsubscribe</title></head>
<body style="margin:0;padding:60px 20px;background:#f6f7f9;font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#111827;text-align:center">
<p style="font-size:16px">${message}</p>${form ? '<form method="post"><button style="padding:10px 20px;border:0;border-radius:8px;background:#111827;color:#fff;font-size:15px;cursor:pointer">Unsubscribe</button></form>' : ''}
</body></html>`)
}

async function findByToken(req) {
    const token = String(req.params.token || '')
    if (!TOKEN_RE.test(token)) return null
    return req.mongo.Models.AgentEmail.findOne({ unsubscribeToken: token }).select('workspaceId to unsubscribedAt').lean()
}

const unsubscribePage = (req, res) => findByToken(req)
    .then((email) => {
        if (!email) return page(res, ResponseCodes['404_NOT_FOUND'], 'This link is not valid.')
        if (email.unsubscribedAt) return page(res, 200, 'You are unsubscribed from these emails.')
        return page(res, 200, 'Stop receiving conversation summary emails?', true)
    })
    .catch(() => page(res, 500, 'Something went wrong. Please try again.'))

const unsubscribe = (req, res) => findByToken(req)
    .then(async (email) => {
        if (!email) return page(res, ResponseCodes['404_NOT_FOUND'], 'This link is not valid.')
        await req.mongo.Models.AgentEmail.updateOne({ _id: email._id, unsubscribedAt: null }, { $set: { unsubscribedAt: new Date() } })
        return page(res, 200, 'You are unsubscribed from these emails.')
    })
    .catch(() => page(res, 500, 'Something went wrong. Please try again.'))

export default {
    list,
    preview,
    getSettings,
    putSettings,
    testSettings,
    unsubscribePage,
    unsubscribe
}
