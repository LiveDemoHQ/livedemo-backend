// Self-check for providerKeys.js — run: PRIVATE_AUTH_TOKEN=x ANAM_API_KEY=ours-anam LEMONSLICE_API_KEY=ours-ls node src/helpers/agent/providerKeys.check.js
// Customer API keys: only Growth workspaces use them, they decrypt only for their own workspace, status never leaks them.
import assert from 'assert'
import { sealKey, resolveKey, publicKeyStatus, isValidKeyFormat, canUseCustomKeys } from './providerKeys.js'

const KEY = 'sk_live_abcdefghijklmnop1234'
const ws = (type, id = 'ws1') => ({
    _id: id,
    type,
    providerKeys: { anam: { enc: sealKey('anam', KEY, 'ws1'), updatedAt: new Date(0) } }
})

assert.strictEqual(resolveKey(ws('growth'), 'anam'), KEY, 'growth uses its own key')
assert.strictEqual(resolveKey(ws('pro'), 'anam'), 'ours-anam', 'other plans fall back to ours')
assert.strictEqual(resolveKey(ws('growth', 'ws2'), 'anam'), 'ours-anam', 'ciphertext copied to another workspace does not decrypt')
assert.strictEqual(resolveKey(ws('growth'), 'lemonslice'), 'ours-ls', 'no saved key = ours')
assert.strictEqual(resolveKey(null, 'anam'), 'ours-anam')

const crossProvider = { _id: 'ws1', type: 'growth', providerKeys: { lemonslice: ws('growth').providerKeys.anam } }
assert.strictEqual(resolveKey(crossProvider, 'lemonslice'), 'ours-ls', 'an Anam ciphertext is not a LemonSlice key')

const status = publicKeyStatus(ws('growth'))
assert.deepStrictEqual(status, { anam: { saved: true, updatedAt: new Date(0) }, lemonslice: { saved: false, updatedAt: null } })
assert.ok(!JSON.stringify(status).includes(ws('growth').providerKeys.anam.enc.slice(0, 20)))

assert.ok(isValidKeyFormat(KEY))
assert.ok(!isValidKeyFormat('short'))
assert.ok(!isValidKeyFormat('has space in the middle 12345'))
assert.ok(!isValidKeyFormat('newline\r\ninjected-key-123456'))
assert.ok(canUseCustomKeys({ type: 'growth' }) && !canUseCustomKeys({ type: 'pro' }) && !canUseCustomKeys(null))

console.log('providerKeys.check OK')
