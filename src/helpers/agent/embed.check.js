// Self-check for embed.js — run: node src/helpers/agent/embed.check.js
// allowedDomains feed a CSP header and postMessage origin checks, so the normalizer is the trust boundary.
import assert from 'assert'
import {

    normalizeDomain,
    allowedOrigin,
    frameAncestors,
    embedPatchUpdates,
    resolveShowBranding,
    resolvePreviewImage
} from './embed.js'
import logger from '../logger.js'

assert.strictEqual(normalizeDomain('https://www.Acme.com:443/pricing?x=1'), 'www.acme.com')
assert.strictEqual(normalizeDomain('*.acme.com'), '*.acme.com')
assert.strictEqual(normalizeDomain('localhost:3000'), 'localhost')
assert.strictEqual(normalizeDomain("acme.com; script-src 'unsafe-inline'"), null, 'CSP injection must be rejected')
assert.strictEqual(normalizeDomain('acme'), null)
assert.strictEqual(normalizeDomain('*.*.acme.com'), null)

assert.strictEqual(allowedOrigin('https://app.acme.com', ['*.acme.com']), 'https://app.acme.com')
assert.strictEqual(allowedOrigin('https://acme.com', ['*.acme.com']), null, 'wildcard does not cover the apex')
assert.strictEqual(allowedOrigin('https://evilacme.com', ['*.acme.com']), null)
assert.strictEqual(allowedOrigin('javascript:alert(1)', []), null)
assert.strictEqual(allowedOrigin('https://x.dev/path', []), 'https://x.dev')

assert.strictEqual(frameAncestors([], 'https://app.livedemo.ai'), '*')
assert.strictEqual(frameAncestors(['acme.com', 'localhost'], 'https://app.livedemo.ai'), 'https://app.livedemo.ai https://acme.com http://localhost:*')

const agent = { _id: 'a1', workspaceId: 'w1', allowedDemoIds: [], embed: { preview: { imageUrl: 'https://s3/x.png' } } }
const free = { featureFlags: { allowRemoveWatermark: false } }
const paid = { featureFlags: { allowRemoveWatermark: true } }

async function rejects(input, user = paid, code = 400) {
    await assert.rejects(embedPatchUpdates({}, agent, user, input), err => err.resultResponse.statusCode === code)
}

await rejects({ accentColor: 'red;}body{display:none' })
await rejects({ launcher: 'popup' })
await rejects({ allowedDomains: ['acme.com', 'not a domain'] })
await rejects({ pill: { placeholder: 'x'.repeat(61) } })
await rejects({ preview: { imageUrl: 'https://evil.com/x.png' } })
await rejects({ showBranding: false }, free, 403)

const updates = await embedPatchUpdates({}, agent, paid, {
    enabled: true,
    launcher: 'pill',
    accentColor: '#1070ff',
    allowedDomains: ['https://Acme.com/', 'acme.com'],
    showBranding: false,
    pill: { expand: 'click' }
})
assert.deepStrictEqual(updates, {
    'embed.launcher': 'pill',
    'embed.pill.expand': 'click',
    'embed.enabled': true,
    'embed.showBranding': false,
    'embed.accentColor': '#1070ff',
    'embed.allowedDomains': ['acme.com']
}, 'partial patch must produce dotted keys only')

const workspaceWith = user => ({
    Workspace: {
        findById: () => ({
            select: () => ({ populate: () => ({ lean: async () => ({ adminUser: user }) }) })
        })
    }
})
assert.strictEqual(await resolveShowBranding(workspaceWith(free), { embed: { showBranding: false } }), true, 'downgraded plan brings branding back')
assert.strictEqual(await resolveShowBranding(workspaceWith(paid), { embed: { showBranding: false } }), false)
assert.strictEqual(await resolveShowBranding({}, { embed: { showBranding: true } }), true)

const demos = [{ _id: 'd1', thumbnailImageUrl: 'https://t/d1.png' }, { _id: 'd2', thumbnailImageUrl: 'https://t/d2.png' }]
assert.strictEqual(await resolvePreviewImage({}, { embed: { preview: { source: 'demo', demoId: 'd2' } } }, demos), 'https://t/d2.png')
assert.strictEqual(await resolvePreviewImage({}, { defaultDemoId: 'd1', embed: { preview: { source: 'demo', demoId: 'gone' } } }, demos), 'https://t/d1.png')
assert.strictEqual(await resolvePreviewImage({}, { embed: { preview: { source: 'custom', imageUrl: 'https://s3/c.png' } } }, demos), 'https://s3/c.png')
assert.strictEqual(await resolvePreviewImage({}, { embed: { preview: { source: 'none' } } }, demos), '')

logger.info('embed.check OK', { eventName: 'EMBED_CHECK_OK' })
