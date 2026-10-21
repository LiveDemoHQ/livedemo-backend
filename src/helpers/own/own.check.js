// Self-check for "Make it yours" — run: node src/helpers/own/own.check.js
// loadOwnableSource + claim tokens are the visitor trust boundary; the rest decides what a claim copies.
import assert from 'assert'
import { loadOwnableSource, createClaimToken, verifyClaimToken, cleanSessionId, MAX_OWN_CLONE_STORIES } from './own.js'
import { storyClosure } from './cloneForClaim.js'
import { remapChecklistForClone } from '../checklist/checklist.js'
import { assertSandboxIntact } from '../sandbox/sandbox.js'
import { PAID_PLAN_USER_FEATURE_FLAGS } from '../subscriptionHelpers.js'

const WS = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const AUTHOR = '999999999999999999999999'
const id = n => String(n).padStart(24, '0')
const query = rows => ({ select: () => ({ lean: async () => rows }) })
const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => {
    if (value && value.$ne !== undefined) return doc[key] !== value.$ne
    if (key === 'deletedAt') return !doc.deletedAt
    return String(doc[key]) === String(value)
})

// --- loadOwnableSource: every gate must hold
const ownable = { enabled: true, enabledBy: AUTHOR, ctaLabel: 'Copy me' }
const sources = {
    [id(1)]: { _id: id(1), name: 'Good', workspaceId: WS, isPublished: true, ownable },
    [id(2)]: { _id: id(2), name: 'Draft', workspaceId: WS, isPublished: false, ownable },
    [id(3)]: { _id: id(3), name: 'Off', workspaceId: WS, isPublished: true, ownable: { ...ownable, enabled: false } },
    [id(4)]: { _id: id(4), name: 'Revoked', workspaceId: WS, isPublished: true, ownable: { ...ownable, enabledBy: id(8) } }
}
let authorFlag = true
const OwnModels = {
    Story: { findOne: ({ _id }) => query(sources[_id] || null) },
    User: { findById: userId => query(String(userId) === AUTHOR ? { featureFlags: { allowOwnableContent: authorFlag } } : { featureFlags: {} }) }
}
assert.deepStrictEqual((await loadOwnableSource(OwnModels, 'story', id(1))).ctaLabel, 'Copy me')
for (const sourceId of [id(2), id(3), id(4), id(5)]) assert.strictEqual(await loadOwnableSource(OwnModels, 'story', sourceId), null, sourceId)
assert.strictEqual(await loadOwnableSource(OwnModels, 'nope', id(1)), null)
assert.strictEqual(await loadOwnableSource(OwnModels, 'story', { $ne: null }), null)
authorFlag = false
assert.strictEqual(await loadOwnableSource(OwnModels, 'story', id(1)), null, 'revoking the author flag is the kill switch')

// --- claim tokens: stored hashed, expiry from the author's ownable.claimTokenTtlHours
authorFlag = true
assert.strictEqual((await loadOwnableSource(OwnModels, 'story', id(1))).claimTokenTtlHours, 2, 'unset/invalid TTL falls back to 2h')
const stored = []
const TokenModels = {
    OwnClaimToken: {
        create: async doc => stored.push(doc),
        exists: async filter => stored.some(doc => doc.token === filter.token &&
            doc.sourceKind === filter.sourceKind &&
            String(doc.sourceId) === String(filter.sourceId) &&
            !(doc.expiresAt && doc.expiresAt <= filter.expiresAt.$not.$lte))
    }
}
const now = Date.now()
const token = await createClaimToken(TokenModels, { kind: 'story', _id: id(1), claimTokenTtlHours: 24 }, now)
assert.ok(!stored.some(doc => doc.token === token), 'raw token never stored')
assert.ok(await verifyClaimToken(TokenModels, token, 'story', id(1), now))
assert.ok(await verifyClaimToken(TokenModels, token, 'story', id(1), now + 23 * 60 * 60 * 1000), 'author TTL honoured')
assert.ok(!(await verifyClaimToken(TokenModels, token, 'story', id(1), now + 25 * 60 * 60 * 1000)), 'expired')
assert.ok(!(await verifyClaimToken(TokenModels, token, 'agent', id(1), now)), 'kind must match')
assert.ok(!(await verifyClaimToken(TokenModels, token, 'story', id(2), now)), 'id must match')
assert.ok(!(await verifyClaimToken(TokenModels, `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`, 'story', id(1), now)), 'unknown token')
assert.ok(!(await verifyClaimToken(TokenModels, undefined, 'story', id(1), now)))
assert.ok(!(await verifyClaimToken(TokenModels, { $ne: null }, 'story', id(1), now)), 'objects never reach a Mongo filter')
const forever = await createClaimToken(TokenModels, { kind: 'story', _id: id(1), claimTokenTtlHours: 0 }, now)
assert.ok(await verifyClaimToken(TokenModels, forever, 'story', id(1), now + 10 * 365 * 24 * 60 * 60 * 1000), '0 = never expires')
sources[id(1)].ownable = { ...ownable, claimTokenTtlHours: 0 }
assert.strictEqual((await loadOwnableSource(OwnModels, 'story', id(1))).claimTokenTtlHours, 0, '"never" is not replaced by the default')

assert.strictEqual(cleanSessionId('3f2c9a1e-1b2c-4d5e-8f90-123456789abc'), '3f2c9a1e-1b2c-4d5e-8f90-123456789abc')
assert.strictEqual(cleanSessionId({ $ne: null }), null, 'objects never reach a Mongo filter')
assert.strictEqual(cleanSessionId('x'), null)

// --- storyClosure: A -> B, A -> C, C -> A (cycle), A -> D (deleted), B -> E (sandbox, not a task)
const A = id(11)
const B = id(12)
const C = id(13)
const D = id(14)
const E = id(15)
const item = (n, type, storyId, stepId = null) => ({ _id: id(100 + n), clickAction: { type, storyId, stepId } })
const graph = [
    { _id: A, workspaceId: WS, custom: { checklist: { version: 4, items: [item(1, 'startDemo', B), item(2, 'openStep', C, id(500)), item(3, 'startDemo', D), item(4, 'url', null)] } } },
    { _id: B, workspaceId: WS, custom: { checklist: { items: [item(5, 'startDemo', E)] } } },
    { _id: C, workspaceId: WS, custom: { checklist: { items: [item(6, 'startDemo', A)] } } },
    { _id: D, workspaceId: WS, deletedAt: new Date() },
    { _id: E, workspaceId: WS, mode: 'sandbox' }
]
const GraphModels = { Story: { findOne: filter => query(graph.find(doc => matches(doc, filter)) || null) } }
const closure = await storyClosure(GraphModels, WS, [A])
assert.deepStrictEqual(closure.map(s => s._id), [A, B, C], 'each story once; deleted and sandbox targets skipped')

const many = Array.from({ length: MAX_OWN_CLONE_STORIES + 1 }, (_, i) => ({ _id: id(1000 + i), workspaceId: WS, custom: { checklist: { items: [item(i, 'startDemo', id(1001 + i))] } } }))
const ManyModels = { Story: { findOne: filter => query(many.find(doc => matches(doc, filter)) || null) } }
await assert.rejects(storyClosure(ManyModels, WS, [id(1000)]), /Too large to claim/)

// --- remapChecklistForClone (phase 2)
const remapped = remapChecklistForClone(graph[0].custom.checklist, {
    storyIdMap: new Map([[A, id(21)], [B, id(22)], [C, id(23)]]),
    stepIdMaps: new Map([[C, new Map([[id(500), id(600)]])]])
})
assert.strictEqual(remapped.version, 1)
assert.deepStrictEqual(remapped.items.map(i => i._id), [id(101), id(102), id(104)], 'item ids kept; deleted target dropped')
assert.strictEqual(String(remapped.items[0].clickAction.storyId), id(22))
assert.strictEqual(String(remapped.items[1].clickAction.storyId), id(23))
assert.strictEqual(String(remapped.items[1].clickAction.stepId), id(600))
const goneStep = remapChecklistForClone({ items: [item(7, 'openStep', C, id(501))] }, { storyIdMap: new Map([[C, id(23)]]), stepIdMaps: new Map([[C, new Map()]]) })
assert.strictEqual(goneStep.items.length, 0, 'step that no longer exists is dropped')

// --- assertSandboxIntact
const S1 = id(31)
const S2 = id(32)
const F1 = id(41)
const sandbox = { flows: [{ _id: F1, startScreenId: S1, screenIds: [S1, S2, id(39)], completion: { screenIds: [S2] } }] }
const copy = { flows: [{ _id: id(51), startScreenId: id(61), screenIds: [id(61), id(62)], completion: { screenIds: [id(62)] } }] }
const sourceIds = new Set([S1, S2, F1])
const pairs = [{ source: { sandboxLinks: [{ gotoScreen: S2, gotoFlowId: F1 }] }, copy: { sandboxLinks: [{ gotoScreen: id(62), gotoFlowId: id(51) }] } }]
assertSandboxIntact(sandbox, copy, pairs, sourceIds)
assert.throws(() => assertSandboxIntact(sandbox, { flows: [{ ...copy.flows[0], screenIds: [id(61)] }] }, pairs, sourceIds), /flow 1/)
assert.throws(() => assertSandboxIntact(sandbox, copy, [{ source: pairs[0].source, copy: { sandboxLinks: [{ gotoScreen: null, gotoFlowId: id(51) }] } }], sourceIds), /link/)

// --- plans never touch the flag
assert.ok(!Object.keys(PAID_PLAN_USER_FEATURE_FLAGS).some(key => key.includes('allowOwnableContent')))

console.log('own.check.js OK')
process.exit(0)
