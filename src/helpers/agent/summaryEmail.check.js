// Self-check for summaryEmail.js — run: node src/helpers/agent/summaryEmail.check.js
// Visitor emails and workspace-written templates are the trust boundary: no header injection, no raw HTML.
import assert from 'assert'
import {
    fillTemplate,
    renderSummaryEmail,
    buildMime,
    normalizeSummarySettings,
    isValidEmail,
    summaryVars
} from './summaryEmail.js'

assert.strictEqual(fillTemplate('Hi {{firstName}}\nDemos: {{demos}}\nBye', { firstName: 'Ana', demos: '' }), 'Hi Ana\nBye', 'line with only empty placeholders is dropped')
assert.strictEqual(fillTemplate('A\n\n{{x}}\n\nB', {}), 'A\n\nB', 'no stacked blank lines')
assert.strictEqual(fillTemplate('{{ name }} / {{unknown}}', { name: 'N' }), 'N /')

const agent = { name: 'Acme <b>', summaryEmail: { subject: 'Hi {{firstName}}\r\nBcc: x@y.z', body: '<script>x</script> {{summary}}\nSee https://a.com/r?x=1&y=2' } }
const out = renderSummaryEmail({ agent, vars: { firstName: 'Ana', summary: 'S' }, unsubscribeUrl: 'https://api/u/t' })
assert.ok(!/[\r\n]/.test(out.subject), 'subject is one line')
assert.ok(!out.html.includes('<script>'), 'template html is escaped')
assert.ok(out.html.includes('Acme &lt;b&gt;'))
assert.ok(out.html.includes('<a href="https://a.com/r?x=1&amp;y=2"'), 'urls are linked')
assert.ok(out.html.includes('https://api/u/t') && out.text.includes('Unsubscribe: https://api/u/t'))

const def = renderSummaryEmail({ agent: { name: 'Bot' }, vars: { firstName: 'Ana', agentName: 'Bot', summary: 'S', recapUrl: '' }, unsubscribeUrl: 'u' })
assert.strictEqual(def.subject, 'Your Bot conversation recap')
assert.ok(!def.text.includes('recap:') && !def.text.includes('Demos'), 'default template drops empty lines')

const from = { name: 'Bot via LiveDemo', email: 'support@livedemo.ai', replyTo: '' }
const mime = buildMime({ from, to: 'a@b.co', subject: 'Ünïcode', html: '<p>x</p>', text: 'x', unsubscribeUrl: 'https://api/u/t' })
assert.ok(mime.includes('From: =?UTF-8?B?') && mime.includes('<support@livedemo.ai>'))
assert.ok(mime.includes('List-Unsubscribe: <https://api/u/t>') && mime.includes('List-Unsubscribe-Post: List-Unsubscribe=One-Click'))
assert.ok(!mime.includes('Reply-To'))
assert.ok(buildMime({ from: { ...from, replyTo: 'sales@acme.io' }, to: 'a@b.co', subject: '', html: '', text: '', unsubscribeUrl: 'u' }).includes('Reply-To: <sales@acme.io>'))
assert.throws(() => buildMime({ from, to: 'a@b.co\r\nBcc: z@z.z', subject: '', html: '', text: '', unsubscribeUrl: 'u' }))
assert.ok(!isValidEmail('a b@c.de') && !isValidEmail('<a@b.co>') && isValidEmail('first.last+tag@sub.acme.io'))

assert.deepStrictEqual(normalizeSummarySettings({ summaryIdleMinutes: '15' }), { summaryIdleMinutes: 15 })
assert.throws(() => normalizeSummarySettings({ summaryIdleMinutes: 7 }))
assert.throws(() => normalizeSummarySettings({ summaryIdleMinutes: 65 }))
assert.throws(() => normalizeSummarySettings({ summaryEmail: { subject: 'a\nb' } }))
assert.deepStrictEqual(normalizeSummarySettings({ summaryEmail: { enabled: 'yes', subject: ' S ', body: 'B\r\n' } }).summaryEmail, { enabled: false, subject: 'S', body: 'B' })

assert.ok(/\/agents\/a1$/.test(summaryVars({ agent: { _id: 'a1' }, session: {}, demos: [] }).agentLink), 'agentLink points at the shared agent page')
assert.strictEqual(summaryVars({ agent: {}, session: { visitorName: 'hari' }, demos: [] }).firstName, 'Hari')
assert.strictEqual(summaryVars({ agent: {}, session: { visitorName: 'Hari Kumar' }, demos: [] }).firstName, 'Hari')
assert.strictEqual(summaryVars({ agent: {}, session: {}, demos: [] }).firstName, 'there')
console.log('summaryEmail.check OK')
