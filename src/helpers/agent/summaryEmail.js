import crypto from 'crypto'
import ENV from '../../envServer.js'
import { emailSettingsOf, senderFor, deliver } from './emailSending.js'
import { recapUrl } from '../workspaceEvents.js'

// Session summary email to the visitor. Templates are plain text with {{placeholders}};
// a line whose placeholders are all empty is dropped, so "Demos: {{demos}}" vanishes when none were watched.

export const IDLE_MINUTES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]
export const PLACEHOLDERS = ['firstName', 'name', 'agentName', 'summary', 'topics', 'demos', 'recapUrl', 'bookingUrl', 'agentLink']
export const DEFAULT_SUBJECT = 'Your {{agentName}} conversation recap'
export const DEFAULT_BODY = [
    'Hi {{firstName}},',
    '',
    'Thanks for taking the time to chat with {{agentName}}.',
    'Here is a quick recap so you have everything in one place.',
    '',
    '{{summary}}',
    '',
    'Demos you watched: {{demos}}',
    '',
    'If you want to go back over it or share it with a teammate, the full recap is here: {{recapUrl}}',
    '',
    'Happy to go deeper with the team whenever suits you. You can pick a time here: {{bookingUrl}}',
    '',
    'Best,',
    '{{agentName}}'
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

// Trailing sentence punctuation belongs to the prose, not the URL
const linkify = escapedLine => escapedLine.replace(/https?:\/\/[^\s<]+/g, (match) => {
    const trailing = (match.match(/(?:[.,;:!?)]|&quot;|&#39;)+$/) || [''])[0]
    const url = match.slice(0, match.length - trailing.length)
    return `<a href="${url}" style="color:#1070ff">${url}</a>${trailing}`
})

const BULLET_RE = /^\s*[-*\u2022]\s+/
// Short "Label:" lines (e.g. "What we covered:") read as headings
const isHeadingLine = line => /^[^:]{1,40}:$/.test(line.trim()) && !/https?:/.test(line)

// One blank-line-separated block -> paragraphs, bulleted lists and headings
function renderBlock(block) {
    const out = []
    let prose = []
    let bullets = []
    const flushProse = () => {
        if (prose.length) out.push(`<p style="margin:0 0 16px">${prose.join('<br>')}</p>`)
        prose = []
    }
    const flushBullets = () => {
        if (bullets.length) out.push(`<ul style="margin:0 0 16px;padding-left:22px">${bullets.map(b => `<li style="margin:0 0 6px">${b}</li>`).join('')}</ul>`)
        bullets = []
    }
    block.split('\n').forEach((line) => {
        if (BULLET_RE.test(line)) {
            flushProse()
            bullets.push(linkify(esc(line.replace(BULLET_RE, '').trim())))
        } else if (isHeadingLine(line)) {
            flushProse()
            flushBullets()
            out.push(`<p style="margin:0 0 8px;font-weight:600">${esc(line.trim())}</p>`)
        } else {
            flushBullets()
            prose.push(linkify(esc(line)))
        }
    })
    flushProse()
    flushBullets()
    return out.join('\n')
}

export function renderSummaryEmail({ agent, vars, unsubscribeUrl }) {
    const settings = agent.summaryEmail || {}
    const subject = fillTemplate(settings.subject || DEFAULT_SUBJECT, vars).replace(/\s+/g, ' ').slice(0, 200)
    const body = fillTemplate(settings.body || DEFAULT_BODY, vars)
    const blocks = body.split(/\n{2,}/).map(renderBlock)
    const footer = `Sent by ${esc(agent.name || 'our demo agent')} via LiveDemo. <a href="${esc(unsubscribeUrl)}" style="color:#6b7280">Unsubscribe</a>`
    const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff">
<div style="max-width:560px;margin:0 auto;font:16px/1.65 -apple-system,'Segoe UI',Arial,sans-serif;color:#1f2937">
${blocks.join('\n')}
</div>
<p style="max-width:560px;margin:28px auto 0;padding-top:16px;border-top:1px solid #e5e7eb;font:12px/1.5 Arial,sans-serif;color:#6b7280">${footer}</p>
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

const capitalize = value => {
    const s = String(value || '').trim()
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

export function summaryVars({ agent, session, lead, demos, origin = ENV.SERVER_URL }) {
    const name = String((lead && lead.data && lead.data.name) || session.visitorName || '').trim()
    const first = name.split(/\s+/)[0]
    return {
        firstName: first ? capitalize(first) : 'there',
        name,
        agentName: agent.name || 'our demo agent',
        summary: session.visitorSummary || session.summary || '',
        topics: (session.topics || []).join(', '),
        demos: demos.map(d => d.name || 'Untitled demo').join(', '),
        recapUrl: agent.recapEnabled === false ? '' : recapUrl(session),
        bookingUrl: (agent.cta && agent.cta.bookMeetingUrl) || '',
        agentLink: agent._id ? `${origin}/agents/${agent._id}` : ''
    }
}

// Called once per session from the final summary job. Every attempt is logged, failures included.
export async function sendSummaryEmail(Models, { agent, session, lead }) {
    if (!agent.summaryEmail || !agent.summaryEmail.enabled) return null
    const workspace = await Models.Workspace.findById(agent.workspaceId).select('+summaryEmailSending').lean()
    const settings = emailSettingsOf(workspace)
    const customDomain = workspace && workspace.customDomain
    const origin = customDomain && customDomain.status === 'active' ? `https://${customDomain.hostname}` : ENV.SERVER_URL
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
    const vars = summaryVars({
        agent,
        session,
        lead,
        demos,
        origin
    })
    const rendered = renderSummaryEmail({
        agent,
        vars,
        unsubscribeUrl
    })

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
