import crypto from 'crypto'
import he from 'he'
import moment from 'moment'
import ENV from '../envServer.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import rateLimit, { clientIp } from '../helpers/agent/rateLimit.js'
import { resolveCta } from '../helpers/agent/validateActions.js'
import { emailDomain } from '../helpers/agent/personalization.js'
import { emitSafe, sessionPayload } from '../helpers/workspaceEvents.js'

import logger from '../helpers/logger.js'

// Public, shareable recap of one agent conversation: GET /recaps/:token (HTML),
// POST /recaps/:token/viewers { email } (a forwarded viewer identifies themselves).
// The token is an unguessable short-uuid minted with the session. Views from
// new IPs / other people at the visitor's company are the buying-committee signal.

const MAX_VIEWER_IPS = 50
const MAX_QA = 30
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const esc = value => he.encode(String(value == null ? '' : value), { useNamedReferences: true })
const safeHref = url => (/^https?:\/\//i.test(String(url || '')) ? esc(url) : '')
// Salted per session: stored hashes can't be joined across sessions or reversed by IP-space lookup tables
const ipHash = (sessionId, ip) => crypto.createHash('sha256').update(`${sessionId}:${ip}`).digest('hex').slice(0, 16)

async function loadRecap(Models, token) {
    if (!/^[A-Za-z0-9-]{10,40}$/.test(String(token || ''))) return {}
    const session = await Models.AgentSession.findOne({ recapToken: token, mode: 'published' }).lean()
    if (!session) return {}
    const agent = await Models.AiDemoAgent.findOne({ _id: session.agentId, deletedAt: null, isPublished: true }).lean()
    if (!agent || agent.recapEnabled === false) return {}
    return { session, agent }
}

function notFound(res) {
    res.status(ResponseCodes['404_NOT_FOUND'])
    res.set({ 'Content-Type': 'text/html; charset=utf-8' })
    res.send('<!doctype html><html><body style="font-family:sans-serif;color:#666;padding:40px">This recap is not available.</body></html>')
}

function renderPage({ session, agent, demos, qa, booking }) {
    const player = `${ENV.STORIES_API}/agents/${agent._id}/player`
    const date = session.startTimestamp ? moment(session.startTimestamp).format('MMM D, YYYY') : ''
    const topics = (session.topics || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')
    const demoList = demos.map(d => `<li><a href="${esc(`${ENV.STORIES_API}/workspaces/${d.workspaceId}/stories/${d._id}/preview`)}" target="_blank" rel="noopener">${esc(d.name || 'Demo')}</a></li>`).join('')
    const qaList = qa.map(m => `<div class="msg ${m.role === 'user' ? 'q' : 'a'}"><b>${m.role === 'user' ? 'Question' : esc(agent.name || 'Agent')}</b><p>${esc(m.content)}</p></div>`).join('')

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(agent.name || 'Demo')} recap</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f6f7f9;color:#1d2433}
main{max-width:720px;margin:0 auto;padding:40px 20px 80px}
header{display:flex;gap:14px;align-items:center;margin-bottom:24px}
header img{width:48px;height:48px;border-radius:50%;object-fit:cover}
h1{font-size:22px;margin:0}h2{font-size:15px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin:28px 0 10px}
.card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.tag{display:inline-block;background:#eef2ff;color:#3730a3;border-radius:999px;padding:3px 10px;font-size:13px;margin:0 6px 6px 0}
.msg{padding:10px 0;border-bottom:1px solid #f0f1f3}.msg:last-child{border:0}.msg p{margin:4px 0 0;white-space:pre-wrap;line-height:1.5}.msg.q b{color:#4f46e5}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}
.btn{display:inline-block;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600;background:#4f46e5;color:#fff}.btn.alt{background:#fff;color:#1d2433;border:1px solid #d1d5db}
.muted{color:#6b7280;font-size:14px}
</style>
</head>
<body>
<main>
<header>
${safeHref(agent.avatarUrl) ? `<img src="${safeHref(agent.avatarUrl)}" alt="">` : ''}
<div><h1>${esc(agent.name || 'Product demo')} — conversation recap</h1><div class="muted">${esc(date)}</div></div>
</header>
<div class="card">
<p style="margin-top:0;line-height:1.6">${esc(session.summary || 'A walkthrough of the product with our AI demo agent.')}</p>
${topics ? `<div>${topics}</div>` : ''}
</div>
${demoList ? `<h2>Demos watched</h2><div class="card"><ul style="margin:0;padding-left:20px;line-height:1.8">${demoList}</ul></div>` : ''}
${qaList ? `<h2>Questions &amp; answers</h2><div class="card">${qaList}</div>` : ''}
<div class="actions">
${booking ? `<a class="btn" href="${safeHref(booking.url)}" target="_blank" rel="noopener">${booking.type === 'book_meeting' ? 'Book a meeting' : 'Start a free trial'}</a>` : ''}
<a class="btn alt" href="${esc(player)}" target="_blank" rel="noopener">Ask the agent yourself</a>
</div>
</main>
</body>
</html>`
}

// Counts the view; a new IP that is not the visitor's own = forwarded, emits recap.viewed
async function recordView(Models, { session, agent, ip }) {
    const hash = ipHash(session._id, ip || 'unknown')
    const ownIp = session.clientIpData && session.clientIpData.ip && ipHash(session._id, session.clientIpData.ip) === hash
    const isNew = !ownIp && !(session.recapViewerIps || []).includes(hash) && (session.recapViewerIps || []).length < MAX_VIEWER_IPS
    const updated = await Models.AgentSession.findOneAndUpdate(
        { _id: session._id },
        { $inc: { recapViews: 1 }, ...(isNew ? { $addToSet: { recapViewerIps: hash } } : {}) },
        { new: true, lean: true }
    )
    await Models.AgentSessionEvent.create({
        sessionId: session._id,
        workspaceId: session.workspaceId,
        agentId: session.agentId,
        type: 'recap_viewed',
        timestamp: moment().valueOf(),
        data: { newViewer: isNew }
    })
    if (isNew) {
        const lead = session.leadId ? await Models.Lead.findById(session.leadId).lean() : null
        emitSafe(Models, session.workspaceId, 'recap.viewed', {
            ...sessionPayload({ session: updated, agent, lead }),
            recap: { views: updated.recapViews, otherViewers: (updated.recapViewerIps || []).length }
        })
    }
}

const view = async function (req, res) {
    const { Models } = req.mongo
    try {
        const { session, agent } = await loadRecap(Models, req.params.token)
        if (!session) return notFound(res)

        const [demos, messages] = await Promise.all([
            Models.Story.find({ _id: { $in: session.viewedDemoIds || [] }, workspaceId: session.workspaceId, deletedAt: null, isPublished: true })
                .select('_id name workspaceId')
                .lean(),
            Models.AgentMessage.find({ sessionId: session._id, content: { $ne: '' } })
                .select('role content')
                .sort({ _id: 1 })
                .limit(MAX_QA * 2)
                .lean()
        ])

        await recordView(Models, { session, agent, ip: clientIp(req) }).catch(err => logger.error('recap view count failed', { eventName: 'RECAP_VIEW_COUNT_FAILED', err: err.message }))

        res.set({
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy': `default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
        })
        res.send(renderPage({
            session,
            agent,
            demos,
            qa: messages,
            booking: resolveCta(agent, session, 'book_meeting')
        }))
    } catch (error) {
        logger.error('recap failed', { eventName: 'RECAP_FAILED', err: error.message })
        notFound(res)
    }
}

const addViewer = async function (req, res) {
    const { Models } = req.mongo
    try {
        await rateLimit(`recap-viewer:${clientIp(req)}`, 5, 60 * 60 * 1000)
        const { session, agent } = await loadRecap(Models, req.params.token)
        if (!session) httpError(ResponseCodes['404_NOT_FOUND'], 'Recap not found')

        const email = String((req.body && req.body.email) || '').trim().toLowerCase().slice(0, 254)
        if (!EMAIL_RE.test(email)) httpError(ResponseCodes['400_BAD_REQUEST'], 'A valid email is required')

        const visitorDomain = emailDomain(session.visitorEmail)
        const sameCompany = !!visitorDomain && emailDomain(email) === visitorDomain
        const existing = await Models.Lead.findOne({ agentSessionId: session._id, 'data.email': email }).select('_id').lean()
        if (!existing) {
            const lead = await new Models.Lead({
                workspaceId: session.workspaceId,
                agentId: session.agentId,
                agentSessionId: session._id,
                capturedVia: 'recap',
                data: { email, sameCompanyAsVisitor: sameCompany }
            }).save()
            emitSafe(Models, session.workspaceId, 'lead.created', {
                ...sessionPayload({ session, agent, lead: lead.toObject() }),
                recap: { forwardedFrom: session.visitorEmail || null, sameCompany }
            })
        }
        sendJson(res, { ok: true })
    } catch (error) {
        sendError(res, error)
    }
}

export default { view, addViewer }
