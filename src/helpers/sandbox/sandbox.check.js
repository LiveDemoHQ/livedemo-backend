// node src/helpers/sandbox/sandbox.check.js
import assert from 'assert/strict'
import mongoose from 'mongoose'
import { planSandboxScreens, anchorFromClick, normalizeLink, normalizeFlows, remapSandbox } from './sandbox.js'

import logger from '../logger.js'

const ev = (timestamp, extra = {}) => ({ timestamp, type: 3, data: { source: 0 }, ...extra })
const base = (ts, href) => [{ timestamp: ts, type: 4, data: { href } }, { timestamp: ts + 1, type: 2, data: {} }]
const delta = (ts, text) => ({ events: [ev(ts)], fromTimeMs: ts, toTimeMs: ts + 50, clickTimestamp: ts, clickX: 100, clickY: 50, targetText: `"${text}"` })

// Chain 1: Dashboard, click Users (SPA), click Settings -> full page load 1s later. Chain 2: Settings page
const plan = planSandboxScreens([
    { baseEvents: base(1000, 'https://app.test/dashboard'), deltas: [delta(2000, 'Users'), delta(3000, 'Settings')] },
    { baseEvents: base(4000, 'https://app.test/settings'), deltas: [] }
])
assert.deepEqual(plan.map(p => p.name), ['/dashboard', 'Users', 'Settings', '/settings'])
assert.deepEqual(plan.map(p => p.linkTo), [1, 3, null, null], 'Users screen links straight to the next page base')
assert.deepEqual(plan.map(p => p.hidden), [false, false, true, false], 'pre-unload state is replay-only')
assert.equal(plan[1].baseIndex, 0)
assert.equal(plan[1].outClick.targetText, '"Settings"')
assert.equal(planSandboxScreens([{ baseEvents: base(1000, 'https://app.test/'), deltas: [delta(2000, 'Data List\n  new')] }])[1].name, 'Data List new')

// Typed URL long after the last click: no link across chains, last delta stays a real screen
const typed = planSandboxScreens([
    { baseEvents: base(1000, 'https://app.test/'), deltas: [delta(2000, 'Open')] },
    { baseEvents: base(60000, 'https://app.test/other'), deltas: [] }
])
assert.deepEqual(typed.map(p => p.linkTo), [1, null, null])
assert.equal(typed[0].name, 'app.test')
assert.ok(!typed[1].hidden)

// Anchors: element rect wins, else a box around the click point; quotes stripped
const viewport = { width: 1000, height: 500 }
const anchor = anchorFromClick(delta(1, 'Users'), { rrwebNodeId: 42, targetSelector: '#users', targetRect: { x: 100, y: 50, width: 200, height: 25 } }, viewport)
assert.deepEqual(anchor, { rrwebNodeId: 42, selector: '#users', matchText: 'Users', rect: { x: 10, y: 10, width: 20, height: 5 } })
assert.deepEqual(anchorFromClick({ clickX: 524, clickY: 274 }, null, viewport).rect, { x: 50, y: 50, width: 4.8, height: 9.6 })
assert.equal(anchorFromClick({ targetText: '"logo" image' }, null, viewport).matchText, '')

// Links: targets must be in this story, rect 0-100
const a = new mongoose.Types.ObjectId()
const b = new mongoose.Types.ObjectId()
const flowId = new mongoose.Types.ObjectId()
const ctx = { screenIds: new Set([String(a), String(b)]), flows: [{ _id: flowId, startScreenId: b }] }
const rect = { x: 1, y: 2, width: 3, height: 4 }
assert.equal(normalizeLink({ gotoType: 'screen', gotoScreen: String(b), anchor: { rect } }, ctx).gotoScreen, String(b))
assert.equal(normalizeLink({ gotoType: 'flow', gotoFlowId: String(flowId), anchor: { rect } }, ctx).gotoScreen, String(b), 'flow links store the flow start')
assert.throws(() => normalizeLink({ gotoType: 'screen', gotoScreen: String(new mongoose.Types.ObjectId()), anchor: { rect } }, ctx), /gotoScreen/)
assert.throws(() => normalizeLink({ gotoType: 'screen', gotoScreen: String(b), anchor: { rect: { ...rect, x: 101 } } }, ctx), /0-100/)
assert.throws(() => normalizeLink({ gotoType: 'website', gotoWebsite: 'javascript:alert(1)', anchor: { rect } }, ctx), /http/)
assert.throws(() => normalizeLink({ gotoType: 'screen', gotoScreen: String(b), anchor: {} }, ctx), /anchor/)
const patched = normalizeLink({ presenterNote: 'hi' }, ctx, { gotoType: 'screen', gotoScreen: String(b), anchor: { rect } })
assert.equal(patched.presenterNote, 'hi')
assert.deepEqual(patched.anchor.rect, rect, 'partial PATCH keeps the anchor')

// Flows: known ids kept, a screen sits in one flow only, foreign ids dropped
const flows = normalizeFlows([
    { _id: String(flowId), name: 'Users', screenIds: [String(a), String(b), 'nope'], completion: { type: 'screen', screenIds: [String(b)] } },
    { _id: 'new', screenIds: [String(b)] }
], { screenIds: ctx.screenIds, currentFlows: [{ _id: flowId, recordingFilePath: '/rec.json' }] })
assert.equal(String(flows[0]._id), String(flowId))
assert.equal(flows[0].recordingFilePath, '/rec.json')
assert.deepEqual(flows[0].screenIds, [String(a), String(b)])
assert.deepEqual(flows[1].screenIds, [])
assert.equal(flows[1].name, 'Flow 2')
assert.notEqual(String(flows[1]._id), 'new')

// Clone: every screen and flow id is remapped
const a2 = new mongoose.Types.ObjectId()
const b2 = new mongoose.Types.ObjectId()
const { sandbox, screenFields } = remapSandbox(
    { startScreenId: a, flows: [{ _id: flowId, startScreenId: b, screenIds: [a, b], completion: { type: 'screen', screenIds: [b] } }] },
    new Map([[String(a), a2], [String(b), b2]])
)
assert.equal(sandbox.startScreenId, a2)
assert.notEqual(String(sandbox.flows[0]._id), String(flowId))
assert.deepEqual(sandbox.flows[0].screenIds, [a2, b2])
assert.deepEqual(sandbox.flows[0].completion.screenIds, [b2])
const fields = screenFields({ sandboxLinks: [{ _id: 'x', gotoType: 'flow', gotoScreen: b, gotoFlowId: flowId }], sandboxDuplicateOf: b })
assert.equal(fields.sandboxLinks[0].gotoScreen, b2)
assert.equal(String(fields.sandboxLinks[0].gotoFlowId), String(sandbox.flows[0]._id))
assert.equal(fields.sandboxLinks[0]._id, undefined)
assert.equal(fields.sandboxDuplicateOf, b2)
assert.deepEqual(screenFields({ steps: [] }), {}, 'guided-shaped screens get no sandbox keys')

logger.info('sandbox.check.js: all good', { eventName: 'SANDBOX_CHECK_JS_ALL_GOOD' })
