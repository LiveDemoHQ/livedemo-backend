// Self-check for the sales-pipeline helpers — run: node src/helpers/agent/pipeline.check.js
// Qualification decides who sees the calendar, personalization vars and webhook
// signatures cross trust boundaries, the crawler must keep tables/alt text.
import assert from 'assert'
import crypto from 'crypto'
import { JSDOM } from 'jsdom'
import { normalizeQualification, coerceValue, writeField, isQualified, missingFields } from './qualification.js'
import { buildPersonalization, encodeVars, decodeVars, emailDomain } from './personalization.js'
import { isPrivateIp } from './publicUrl.js'
import { domToMarkdown, normalizeLink } from './siteCrawler.js'
import { resolveCta, isInlineCalendarUrl } from './validateActions.js'
import { normalizeEmbedRules } from './embed.js'
import { signBody, slackText } from '../workspaceEvents.js'

import logger from '../logger.js'

// --- qualification
const qualification = normalizeQualification({
    enabled: true,
    fields: [
        { key: 'Team Size', label: 'Team size', question: 'How big is your team?', type: 'number', rule: { op: 'gte', value: 20 } },
        { key: 'role', label: 'Role', type: 'select', options: ['Sales', 'Marketing'], rule: { op: 'in', value: ['Sales'] } }
    ]
})
const agent = { qualification, cta: { bookMeetingUrl: 'https://calendly.com/acme/demo', startTrialUrl: 'https://acme.com/trial' } }
assert.strictEqual(qualification.fields[0].key, 'team_size')
assert.throws(() => normalizeQualification({ enabled: true, fields: [{ key: 'email' }] }), e => e.isValidation, 'built-in keys are reserved')
assert.strictEqual(coerceValue({ type: 'number' }, 'about 1.5k people'), 1500)
assert.strictEqual(coerceValue({ type: 'select', options: ['Sales'] }, 'sales'), 'Sales')
assert.strictEqual(coerceValue({ type: 'select', options: ['Sales'] }, 'CEO'), undefined)
assert.strictEqual(coerceValue({ key: 'email', type: 'text' }, 'not-an-email'), undefined)

let fields = writeField({}, 'team_size', 50, 'self_reported')
assert.strictEqual(writeField(fields, 'team_size', 5, 'extracted'), null, 'a guess never overwrites what the visitor said')
assert.ok(!isQualified(agent, fields), 'one rule still missing')
assert.deepStrictEqual(missingFields(agent, fields).map(f => f.key), ['role'])
fields = writeField(fields, 'role', 'Sales', 'self_reported')
assert.ok(isQualified(agent, fields))
assert.ok(!isQualified(agent, writeField(fields, 'team_size', 10, 'user_confirmed')))

// --- CTA gate: the model can only ask; unqualified visitors get the trial link
assert.deepStrictEqual(resolveCta(agent, { qualified: false }, 'book_meeting'), { type: 'start_trial', url: 'https://acme.com/trial', inline: false })
assert.deepStrictEqual(resolveCta(agent, { qualified: true }, 'book_meeting'), { type: 'book_meeting', url: 'https://calendly.com/acme/demo', inline: true })
assert.strictEqual(resolveCta(agent, { qualified: true }, 'javascript:alert(1)'), null)
assert.ok(isInlineCalendarUrl('https://cal.com/acme/30min'))
assert.ok(!isInlineCalendarUrl('https://calendly.com.evil.io/x'))

// --- personalization
assert.strictEqual(emailDomain('jane@gmail.com'), '', 'free mail is not a company')
const personal = buildPersonalization({ name: 'Jane Doe', email: 'jane@acme-corp.com' })
assert.strictEqual(personal.company, 'Acme Corp')
assert.strictEqual(personal.firstName, 'Jane')
assert.deepStrictEqual(decodeVars(encodeVars({ company: 'Acme' })), [{ name: 'company', value: 'Acme' }])
const hostile = Buffer.from(JSON.stringify({ 'bad name': 'x', __proto__x: 1, ok: 'y'.repeat(500), obj: { a: 1 } })).toString('base64url')
assert.deepStrictEqual(decodeVars(hostile).map(v => [v.name, v.value.length]), [['ok', 200]])
assert.deepStrictEqual(decodeVars('%%%'), [])

// --- SSRF guard
assert.ok(isPrivateIp('10.0.0.5') && isPrivateIp('169.254.169.254') && isPrivateIp('::ffff:127.0.0.1') && isPrivateIp('fd00::1'))
assert.ok(!isPrivateIp('93.184.216.34'))

// --- webhook signing + Slack escaping
const body = '{"a":1}'
assert.strictEqual(signBody('whsec_x', '1700000000', body), `sha256=${crypto.createHmac('sha256', 'whsec_x').update(`1700000000.${body}`).digest('hex')}`)
const text = slackText('lead.created', { lead: { email: '<!channel> x@y.com' }, session: {} })
assert.ok(!text.includes('<!channel>'), 'visitor text cannot ping the channel')

// --- page rules
assert.deepStrictEqual(normalizeEmbedRules([{ urlPattern: '/pricing', starterQuestions: [' How much? ', ''] }])[0].starterQuestions, ['How much?'])
assert.throws(() => normalizeEmbedRules([{ urlPattern: 'javascript:x' }]))
assert.deepStrictEqual(normalizeEmbedRules([{ urlPattern: '/checkout', hidden: true }, { urlPattern: '*', hidden: 'yes' }]).map(r => r.hidden), [true, false])

// --- crawler extraction
const { window } = new JSDOM(`<body>
    <nav><a href="/a">Menu</a></nav>
    <main>
        <h1>Pricing</h1>
        <p>Simple plans.</p>
        <img src="x.png" alt="Pricing chart">
        <table><tr><th>Plan</th><th>Price</th></tr><tr><td>Pro</td><td>$49</td></tr></table>
        <ul><li>SSO</li><li>Audit log</li></ul>
    </main>
    <footer>© Acme</footer>
</body>`)
const md = domToMarkdown(window.document)
assert.ok(md.includes('# Pricing'))
assert.ok(md.includes('| Plan | Price |') && md.includes('| Pro | $49 |'), md)
assert.ok(md.includes('[Image: Pricing chart]'))
assert.ok(md.includes('- SSO'))
assert.ok(!md.includes('Menu') && !md.includes('© Acme'), 'nav and footer are stripped')
assert.strictEqual(normalizeLink('/docs#top', 'https://acme.com'), 'https://acme.com/docs')
assert.strictEqual(normalizeLink('https://other.com/x', 'https://acme.com'), null)
assert.strictEqual(normalizeLink('/brochure.pdf', 'https://acme.com'), null)

logger.info('pipeline.check OK', { eventName: 'PIPELINE_CHECK_OK' })
