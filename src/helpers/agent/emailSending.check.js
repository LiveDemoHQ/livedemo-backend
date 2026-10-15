// Self-check for emailSending.js — run: PRIVATE_AUTH_TOKEN=x node src/helpers/agent/emailSending.check.js
// Workspace-supplied SMTP settings are the trust boundary: validated hosts/addresses, secret never exposed.
import assert from 'assert'
import {
    encryptSecret,
    decryptSecret,
    normalizeEmailSettings,
    publicEmailSettings,
    senderFor,
    deliver
} from './emailSending.js'

const enc = encryptSecret('p@ss')
assert.notStrictEqual(enc, encryptSecret('p@ss'), 'random iv')
assert.strictEqual(decryptSecret(enc), 'p@ss')
assert.throws(() => decryptSecret(enc.replace(/^./, c => (c === 'A' ? 'B' : 'A'))), 'tampering is detected')

const smtp = { host: 'smtp.acme.io', port: 587, user: 'u', password: 'secret', fromEmail: 'Sales@Acme.io', fromName: 'Acme "Team"\r\n' }
const saved = normalizeEmailSettings({ mode: 'smtp', smtp }, {})
assert.strictEqual(saved.smtp.fromEmail, 'sales@acme.io')
assert.strictEqual(saved.smtp.fromName, 'Acme Team')
assert.strictEqual(decryptSecret(saved.smtp.passEnc), 'secret')
assert.ok(!('password' in saved.smtp))

const workspace = { summaryEmailSending: saved }
const kept = normalizeEmailSettings({ mode: 'smtp', smtp: { ...smtp, password: '' } }, workspace)
assert.strictEqual(kept.smtp.passEnc, saved.smtp.passEnc, 'blank password keeps the stored one')
assert.deepStrictEqual(normalizeEmailSettings({ mode: 'livedemo' }, workspace).smtp, saved.smtp, 'switching mode keeps smtp for later')

const pub = publicEmailSettings(workspace)
assert.ok(pub.smtp.hasPassword && !JSON.stringify(pub).includes(saved.smtp.passEnc), 'password never returned')
assert.strictEqual(publicEmailSettings({}).mode, 'disabled', 'disabled by default')

for (const bad of [
    { mode: 'nope' },
    { mode: 'smtp', smtp: { ...smtp, host: 'http://x.io' } },
    { mode: 'smtp', smtp: { ...smtp, host: 'localhost' } },
    { mode: 'smtp', smtp: { ...smtp, port: 22 } },
    { mode: 'smtp', smtp: { ...smtp, fromEmail: 'a@b.co\r\nBcc: x@y.z' } },
    { mode: 'smtp', smtp: { ...smtp, replyTo: 'nope' } },
    { mode: 'smtp', smtp: { ...smtp, password: '' } }
]) {
    assert.throws(() => normalizeEmailSettings(bad, {}), JSON.stringify(bad))
}

assert.strictEqual(senderFor({ mode: 'disabled' }, 'Bot'), null)
assert.deepStrictEqual(senderFor({ mode: 'livedemo' }, 'Bot'), { name: 'Bot via LiveDemo', email: 'support@livedemo.ai', replyTo: '' })
assert.strictEqual(senderFor(saved, 'Bot').email, 'sales@acme.io')

await assert.rejects(() => deliver({ mode: 'disabled' }, { to: 'a@b.co', mime: '' }))
await assert.rejects(() => deliver({ mode: 'smtp', smtp: { ...saved.smtp, host: '127.0.0.1' } }, { to: 'a@b.co', mime: '' }), /public/)

console.log('emailSending.check OK')
