import crypto from 'crypto'
import ENV from '../../envServer.js'
import { emailSettingsOf, senderFor, deliver } from './emailSending.js'
import { recapUrl } from '../workspaceEvents.js'

// Session summary email to the visitor. Templates are plain text with {{placeholders}};
// a line whose placeholders are all empty is dropped, so "Demos: {{demos}}" vanishes when none were watched.

export const IDLE_MINUTES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]
export const PLACEHOLDERS = ['firstName', 'name', 'agentName', 'summary', 'topics', 'demos', 'recapUrl', 'bookingUrl']
export const DEFAULT_SUBJECT = 'Your {{agentName}} conversation recap'
export const DEFAULT_BODY = [
    'Hi {{firstName}},',
    '',
    'Thanks for chatting with {{agentName}}. Here is a quick recap of our conversation:',
    '',
    '{{summary}}',
    '',
    'Demos you watched: {{demos}}',
    '',
    'See the full recap: {{recapUrl}}',
    '',
    'Want to talk to the team? Book a time: {{bookingUrl}}'
].join('\n')

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/
const TOKEN_RE = /\{\{\s*(\w+)\s*\}\}/g
const esc = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export function isValidEmail(email) {
    return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email)
}

export function normalizeSummarySettings(body) {
    const updates = {}
    if (body.summaryIdleMinutes !== undefined) {
        const minutes = Number(body.summaryIdleMinutes)
        if (!IDLE_MINUTES.includes(minutes)) throw Object.assign(new Error('summaryIdleMinutes must be 5-60 in steps of 5'), { isValidation: true })
        updates.summaryIdleMinutes = minutes
    }
    if (body.summaryEmail !== undefined) {
        const input = body.summaryEmail || {}
        const subject = String(input.subject || '').trim()
        const text = String(input.body || '').replace(/\r\n/g, '\n').trim()
        if (subject.length > 200 || /[\r\n]/.test(subject)) throw Object.assign(new Error('summaryEmail.subject must be one line, up to 200 characters'), { isValidation: true })
        if (text.length > 5000) throw Object.assign(new Error('summaryEmail.body must be up to 5000 characters'), { isValidation: true })
        updates.summaryEmail = { enabled: input.enabled === true, subject, body: text }
    }
    return updates
}

export function fillTemplate(template, vars) {
    return template.split('\n')
        .filter((line) => {
            const keys = [...line.matchAll(TOKEN_RE)].map(m => m[1])
            return !keys.length || keys.some(key => vars[key])
        })
        .map(line => line.replace(TOKEN_RE, (_, key) => vars[key] || ''))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

const linkify = escapedLine => escapedLine.replace(/https?:\/\/[^\s<]+/g, url => `<a href="${url}" style="color:#1070ff">${url}</a>`)

export function renderSummaryEmail({ agent, vars, unsubscribeUrl }) {
    const settings = agent.summaryEmail || {}
    const subject = fillTemplate(settings.subject || DEFAULT_SUBJECT, vars).replace(/\s+/g, ' ').slice(0, 200)
    const body = fillTemplate(settings.body || DEFAULT_BODY, vars)
    const paragraphs = body.split(/\n{2,}/).map(p => `<p style="margin:0 0 16px">${p.split('\n').map(line => linkify(esc(line))).join('<br>')}</p>`)
    const footer = `Sent by ${esc(agent.name || 'our demo agent')} via LiveDemo. <a href="${esc(unsubscribeUrl)}" style="color:#6b7280">Unsubscribe</a>`
    const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9">
<div style="max-width:560px;margin:0 auto;padding:28px;background:#fff;border-radius:12px;font:15px/1.6 -apple-system,'Segoe UI',Arial,sans-serif;color:#111827">
${paragraphs.join('\n')}
</div>
<p style="max-width:560px;margin:16px auto 0;font:12px/1.5 Arial,sans-serif;color:#6b7280;text-align:center">${footer}</p>
</body></html>`
    const text = `${body}\n\n--\nSent by ${agent.name || 'our demo agent'} via LiveDemo. Unsubscribe: ${unsubscribeUrl}`
    return { subject, html, text }
}

export function unsubscribeUrlFor(token) {
    return `${ENV.STORIES_API}/agent-emails/unsubscribe/${token}`
}

const encodeWord = value => `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
const base64Lines = value => Buffer.from(value, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n')

export function buildMime({ from, to, subject, html, text, unsubscribeUrl }) {
    if (!isValidEmail(to) || !isValidEmail(from.email) || (from.replyTo && !isValidEmail(from.replyTo))) throw new Error('Invalid address')
    const boundary = `ld-${crypto.randomBytes(12).toString('hex')}`
    return [
        `From: ${from.name ? `${encodeWord(from.name)} ` : ''}<${from.email}>`,
        `To: <${to}>`,
        ...(from.replyTo ? [`Reply-To: <${from.replyTo}>`] : []),
        `Subject: ${encodeWord(subject)}`,
        'MIME-Version: 1.0',
        `List-Unsubscribe: <${unsubscribeUrl}>`,
        'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        base64Lines(text),
        `--${boundary}`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        base64Lines(html),
        `--${boundary}--`,
        ''
    ].join('\r\n')
}

export function summaryVars({ agent, session, lead, demos }) {
    const name = String((lead && lead.data && lead.data.name) || session.visitorName || '').trim()
    return {
        firstName: name.split(/\s+/)[0] || 'there',
        name,
        agentName: agent.name || 'our demo agent',
        summary: session.visitorSummary || session.summary || '',
        topics: (session.topics || []).join(', '),
        demos: demos.map(d => d.name || 'Untitled demo').join(', '),
        recapUrl: agent.recapEnabled === false ? '' : recapUrl(session),
        bookingUrl: (agent.cta && agent.cta.bookMeetingUrl) || ''
    }
}

// Called once per session from the final summary job. Every attempt is logged, failures included.
export async function sendSummaryEmail(Models, { agent, session, lead }) {
    if (!agent.summaryEmail || !agent.summaryEmail.enabled) return null
    const settings = emailSettingsOf(await Models.Workspace.findById(agent.workspaceId).select('+summaryEmailSending').lean())
    const from = senderFor(settings, agent.name)
    if (!from) return null
    const to = String((lead && lead.data && lead.data.email) || session.visitorEmail || '').trim().toLowerCase()
    if (!isValidEmail(to)) return null
    if (await Models.AgentEmail.exists({ workspaceId: agent.workspaceId, to, unsubscribedAt: { $ne: null } })) return null

    const demos = (session.viewedDemoIds || []).length
        ? await Models.Story.find({ _id: { $in: session.viewedDemoIds } }).select('name').lean()
        : []
    const unsubscribeToken = crypto.randomBytes(24).toString('base64url')
    const unsubscribeUrl = unsubscribeUrlFor(unsubscribeToken)
    const rendered = renderSummaryEmail({ agent, vars: summaryVars({ agent, session, lead, demos }), unsubscribeUrl })

    const doc = {
        workspaceId: agent.workspaceId,
        agentId: agent._id,
        sessionId: session._id,
        leadId: session.leadId || (lead && lead._id) || undefined,
        to,
        from: from.email,
        ...rendered,
        unsubscribeToken
    }
    try {
        const messageId = await deliver(settings, { to, mime: buildMime({ from, to, ...rendered, unsubscribeUrl }) })
        return await Models.AgentEmail.create({ ...doc, status: 'sent', messageId })
    } catch (err) {
        console.log('Summary email failed', err.message)
        return await Models.AgentEmail.create({ ...doc, status: 'failed', error: String(err.message || err).slice(0, 500) })
    }
}
