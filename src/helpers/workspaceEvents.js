import crypto from 'crypto'
import axios from 'axios'
import ENV from '../envServer.js'
import enqueueJob from './enqueueJob.js'
import { assertPublicUrl } from './agent/publicUrl.js'
import { flattenFields } from './agent/qualification.js'
import { open } from './secretBox.js'

// Outbound events: one monq job per (event, subscription) so a slow or dead
// endpoint only retries itself. Delivery runs in processAgentSession.js.

export const EVENTS = ['lead.created', 'lead.qualified', 'session.ended', 'meeting.booked', 'recap.viewed', 'demo.viewed', 'demo.completed', 'demo.lead']
export const SLACK_URL_RE = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/
export const ANALYTICS_URLS = {
    ga4: 'https://www.google-analytics.com/mp/collect',
    segment: 'https://api.segment.io/v1/track'
}
export const analyticsPurpose = kind => `analytics:${kind}`

const RETRY = { attempts: { count: 5, delay: 30000, strategy: 'exponential' } }

export function recapUrl(session) {
    return session && session.recapToken ? `${ENV.STORIES_API}/recaps/${session.recapToken}` : ''
}

export function replayUrl(session) {
    return `${ENV.SERVER_URL}/analytics?agent=${session.agentId}&agentSession=${session._id}`
}

// The `data` object every event carries. Plain JSON, safe to hand to customers.
export function sessionPayload({ session, agent, lead }) {
    const source = session.source || {}
    return {
        session: {
            id: String(session._id),
            agentId: String(session.agentId),
            agentName: (agent && agent.name) || '',
            startedAt: session.startTimestamp ? new Date(session.startTimestamp).toISOString() : null,
            endedAt: session.endTimestamp ? new Date(session.endTimestamp).toISOString() : null,
            durationMs: session.duration || 0,
            messageCount: session.messageCount || 0,
            demosOpened: session.demosOpenedCount || 0,
            summary: session.summary || '',
            topics: session.topics || [],
            intent: session.intent || null,
            unanswered: session.unanswered || [],
            qualified: !!session.qualified,
            fields: flattenFields(session.fields),
            meetingBookedAt: session.meetingBookedAt || null,
            pageUrl: source.pageUrl || '',
            referrer: source.referrer || '',
            utm: source.utm || {},
            country: (session.clientIpData && session.clientIpData.country) || '',
            replayUrl: replayUrl(session),
            recapUrl: recapUrl(session)
        },
        lead: lead ? {
            id: String(lead._id),
            name: (lead.data && lead.data.name) || session.visitorName || '',
            email: (lead.data && lead.data.email) || session.visitorEmail || '',
            capturedVia: lead.capturedVia || ''
        } : null
    }
}

// Interactive demo (story) events: demo.viewed / demo.completed / demo.lead
export function demoPayload({ story, session, lead }) {
    return {
        demo: { id: String(story._id), name: story.name || '' },
        session: session ? {
            id: String(session._id),
            stepsCount: session.stepsCount || 0,
            country: (session.clientIpData && session.clientIpData.country) || ''
        } : null,
        lead: lead ? {
            id: String(lead._id),
            name: (lead.data && lead.data.name) || '',
            email: (lead.data && lead.data.email) || ''
        } : null
    }
}

// GA4 / Segment get ids and facts only. Google's terms forbid PII, so lead name/email never leave.
export function analyticsEvent(event) {
    const data = event.data || {}
    const session = data.session || {}
    const demo = data.demo || {}
    const params = {
        session_id: session.id,
        agent_id: session.agentId,
        agent_name: session.agentName,
        demo_id: demo.id,
        demo_name: demo.name,
        intent: session.intent,
        qualified: session.qualified,
        demos_opened: session.demosOpened,
        country: session.country
    }
    Object.keys(params).forEach(key => (params[key] === undefined || params[key] === '' || params[key] === null) && delete params[key])
    return { name: `livedemo_${event.type.replace('.', '_')}`, clientId: session.id || event.id, params }
}

function analyticsRequest(hook, event) {
    const secret = open(hook.secret, analyticsPurpose(hook.kind), String(hook.workspaceId))
    const { name, clientId, params } = analyticsEvent(event)
    if (hook.kind === 'ga4') {

        const query = new URLSearchParams({ measurement_id: hook.measurementId, api_secret: secret })
        return {
            url: `${ANALYTICS_URLS.ga4}?${query}`,
            body: JSON.stringify({ client_id: clientId, events: [{ name, params }] }),
            headers: { 'Content-Type': 'application/json' }
        }
    }
    return {
        url: ANALYTICS_URLS.segment,
        body: JSON.stringify({ anonymousId: clientId, event: name, properties: params, messageId: event.id, timestamp: event.createdAt }),
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${secret}:`).toString('base64')}` }
    }
}

// Stripe-style: signature over `${timestamp}.${body}` so a replayed body with a new timestamp fails
export function signBody(secret, timestamp, body) {
    return `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
}

const EVENT_TITLES = {
    'lead.created': '👋 New lead',
    'lead.qualified': '🔥 Qualified lead',
    'session.ended': '💬 Agent conversation',
    'meeting.booked': '📅 Meeting booked',
    'recap.viewed': '🔁 Recap forwarded',
    'demo.viewed': '👀 Demo viewed',
    'demo.completed': '🏁 Demo completed',
    'demo.lead': '👋 Demo lead'
}

// Slack mrkdwn: escape &, <, > in anything a visitor typed
const esc = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function slackText(event, data) {
    const s = data.session || {}
    const who = (data.lead && (data.lead.email || data.lead.name)) || 'Anonymous visitor'
    const facts = Object.entries(s.fields || {})
        .filter(([key]) => !['name', 'email'].includes(key))
        .map(([key, value]) => `${key}: ${value}`)
        .slice(0, 6)
    const lines = [
        `*${EVENT_TITLES[event] || event}*: ${esc(who)}${s.agentName ? ` · ${esc(s.agentName)}` : ''}${data.demo ? ` · ${esc(data.demo.name)}` : ''}`,
        s.summary ? `>${esc(s.summary).slice(0, 600)}` : '',
        [s.intent ? `intent: ${s.intent}` : '', s.demosOpened ? `watched ${s.demosOpened} demo${s.demosOpened === 1 ? '' : 's'}` : '', ...facts].filter(Boolean).map(esc).join(' · '),
        [s.replayUrl ? `<${s.replayUrl}|Replay>` : '', s.recapUrl ? `<${s.recapUrl}|Recap>` : ''].filter(Boolean).join('  ')
    ]
    return lines.filter(Boolean).join('\n')
}

export async function emitWorkspaceEvent(Models, workspaceId, event, data) {
    const hooks = await Models.WorkspaceWebhook.find({ workspaceId, enabled: true, events: event }).select('_id').lean()
    const createdAt = new Date().toISOString()
    const id = `evt_${crypto.randomBytes(12).toString('hex')}`
    await Promise.all(hooks.map(hook => enqueueJob('agent-session', 'deliverWebhook', {
        hookId: String(hook._id),
        event: { id, type: event, createdAt, workspaceId: String(workspaceId), data }
    }, RETRY)))
}

// Never throws: event fan-out must not break the request that triggered it
export function emitSafe(Models, workspaceId, event, data) {
    return emitWorkspaceEvent(Models, workspaceId, event, data)
        .catch(err => console.log(`emit ${event} failed`, err.message))
}

// Fire-and-forget from public story routes; the workspace comes from the story, never from the URL
export function emitDemoEvent(Models, storyId, event, { session, lead } = {}) {
    return Models.Story.findById(storyId).select('name workspaceId').lean()
        .then(story => story && emitWorkspaceEvent(Models, story.workspaceId, event, demoPayload({ story, session, lead })))
        .catch(err => console.log(`emit ${event} failed`, err.message))
}

// Returns { status }. Throws on non-2xx so monq retries.
export async function deliverWebhook(Models, hook, event) {
    let body
    let url = hook.url
    let headers = { 'Content-Type': 'application/json', 'User-Agent': 'LiveDemo-Webhooks/1.0' }
    if (ANALYTICS_URLS[hook.kind]) {

        const request = analyticsRequest(hook, event)
        url = request.url
        body = request.body
        headers = { ...headers, ...request.headers }
    } else if (hook.kind === 'slack') {
        if (!SLACK_URL_RE.test(hook.url)) throw new Error('Not a Slack incoming-webhook URL')
        body = JSON.stringify({ text: slackText(event.type, event.data) })
    } else {
        await assertPublicUrl(hook.url, { httpsOnly: ENV.ENV !== 'dev' })
        body = JSON.stringify(event)
        const timestamp = String(Math.floor(Date.now() / 1000))
        headers = {
            ...headers,
            'X-LiveDemo-Event': event.type,
            'X-LiveDemo-Delivery': event.id,
            'X-LiveDemo-Timestamp': timestamp,
            'X-LiveDemo-Signature': signBody(hook.secret, timestamp, body)
        }
    }

    try {
        const res = await axios.post(url, body, { headers, timeout: 10000, maxRedirects: 0, validateStatus: () => true })
        const ok = res.status >= 200 && res.status < 300
        await Models.WorkspaceWebhook.updateOne({ _id: hook._id }, {
            $set: { lastStatus: res.status, lastError: ok ? '' : `HTTP ${res.status}`, lastDeliveredAt: new Date() }
        })
        if (!ok) throw new Error(`HTTP ${res.status}`)
        return { status: res.status }
    } catch (err) {
        await Models.WorkspaceWebhook.updateOne({ _id: hook._id }, { $set: { lastError: String(err.message).slice(0, 300) } })
        throw err
    }
}
