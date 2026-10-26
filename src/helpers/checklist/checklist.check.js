// Self-check for the StoryDemo checklist — run: node src/helpers/checklist/checklist.check.js
// normalizeChecklist is the editor trust boundary, getChecklistContext decides what viewers see,
// applyProgressEvents is the untrusted viewer boundary.
import assert from 'assert'
import { normalizeChecklist, getChecklistContext, applyProgressEvents, copyChecklist, configJson } from './checklist.js'

import logger from '../logger.js'

const WS = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const HOST = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const TASK = 'cccccccccccccccccccccccc'
const SANDBOX = 'dddddddddddddddddddddddd'
const FOREIGN = 'eeeeeeeeeeeeeeeeeeeeeeee'
const ITEM_A = '111111111111111111111111'
const ITEM_B = '222222222222222222222222'
const TOKEN = 'f'.repeat(32)

const checklist = {
    isActive: true,
    version: 2,
    title: 'Hi {{company}}',
    launcher: { text: 'Go' },
    items: [
        { _id: ITEM_A, title: '', clickAction: { type: 'startDemo', storyId: HOST }, completion: 'demoComplete' },
        { _id: ITEM_B, title: 'Setup', clickAction: { type: 'startDemo', storyId: TASK }, completion: 'demoComplete' }
    ]
}
const stories = [
    { _id: HOST, workspaceId: WS, name: 'Host demo', thumbnailImageUrl: 'h.png', isPublished: true, custom: { checklist, theme: {} } },
    { _id: TASK, workspaceId: WS, name: 'Task demo', thumbnailImageUrl: 't.png' },
    { _id: SANDBOX, workspaceId: WS, name: 'Sandbox', mode: 'sandbox' },
    { _id: FOREIGN, workspaceId: 'ffffffffffffffffffffffff', name: 'Other', custom: { checklist } }
]
const matches = (doc, query) => (!query._id || (query._id.$in ? query._id.$in.map(String).includes(String(doc._id)) : String(query._id) === String(doc._id))) &&
    (!query.workspaceId || String(doc.workspaceId) === String(query.workspaceId)) &&
    (!query.mode || doc.mode !== query.mode.$ne) &&
    !doc.deletedAt
const chain = value => ({ select: () => ({ lean: async () => value }) })
const progressDocs = [{ token: TOKEN, hostStoryId: HOST, completedItemIds: [ITEM_A], state: 'open', firstOpenedAt: 5, checklistVersion: 2 }]
const Models = {
    Story: {
        find: query => chain(stories.filter(doc => matches(doc, query))),
        findOne: query => chain(stories.find(doc => matches(doc, query)) || null)
    },
    ChecklistProgress: {
        findOne: query => chain(progressDocs.find(doc => doc.token === query.token && String(doc.hostStoryId) === String(query.hostStoryId)) || null)
    }
}
const host = stories[0]
const task = stories[1]
const body = items => ({ isActive: true, items })
const item = (storyId, _id) => ({ ...(_id ? { _id } : {}), clickAction: { type: 'startDemo', storyId } })

// normalizeChecklist: references, images, version bump
await assert.rejects(normalizeChecklist(Models, host, body([item(TASK), item(TASK)])), /once/, 'duplicate demo rejected')
await assert.rejects(normalizeChecklist(Models, host, body([item(SANDBOX)])), /guided demo/, 'sandbox demo rejected')
await assert.rejects(normalizeChecklist(Models, host, body([item(FOREIGN)])), /guided demo/, 'foreign workspace demo rejected')
await assert.rejects(normalizeChecklist(Models, host, { ...body([]), logoUrl: 'https://evil.com/x.png' }), /uploaded/, 'non-CDN logo rejected')
const same = await normalizeChecklist(Models, host, body([item(HOST, ITEM_A), item(TASK, ITEM_B)]))
assert.strictEqual(same.version, 2, 'same items keep the version')
const changed = await normalizeChecklist(Models, host, body([item(HOST, ITEM_A)]))
assert.strictEqual(changed.version, 3, 'removed item bumps the version')
const added = await normalizeChecklist(Models, host, body([item(HOST, ITEM_A), item(TASK, ITEM_B), { clickAction: { type: 'url', url: 'javascript:alert(1)' } }]))
assert.ok(added.items[2]._id && added.version === 3, 'new item gets an id and bumps the version')
assert.strictEqual(added.items[2].clickAction.url, 'about:blank', 'unsafe url sanitized')

// openStep: may share a demo with startDemo items, the demo must still be valid
const STEP = '333333333333333333333333'
const stepItem = storyId => ({ clickAction: { type: 'openStep', storyId, stepId: STEP }, completion: 'click' })
const withSteps = await normalizeChecklist(Models, host, body([item(HOST, ITEM_A), stepItem(HOST), stepItem(TASK), stepItem(TASK)]))
assert.strictEqual(withSteps.items.length, 4, 'step items do not count as duplicate demos')
await assert.rejects(normalizeChecklist(Models, host, body([stepItem(FOREIGN)])), /guided demo/, 'step in a foreign demo rejected')
const stepCtx = await getChecklistContext(Models, { ...host, custom: { ...host.custom, checklist: { ...checklist, items: [{ _id: ITEM_B, ...stepItem(TASK) }] } } }, {})
assert.deepStrictEqual([stepCtx.checklist.items[0].clickAction.storyId, stepCtx.checklist.items[0].clickAction.stepId], [TASK, STEP], 'step target reaches the player')
const NEW_STEP = '444444444444444444444444'
const copiedSteps = await copyChecklist(Models, { items: [stepItem(HOST), stepItem(TASK), stepItem(FOREIGN)] }, { oldStoryId: HOST, newStoryId: '999999999999999999999999', workspaceId: WS, stepIds: new Map([[STEP, NEW_STEP]]) })
assert.deepStrictEqual(copiedSteps.items.map(i => [String(i.clickAction.storyId), String(i.clickAction.stepId)]), [['999999999999999999999999', NEW_STEP], [TASK, STEP]], 'self step follows the cloned step, other demo untouched, foreign dropped')

// getChecklistContext
const selfCtx = await getChecklistContext(Models, host, { variables: [{ name: 'company', value: 'Acme' }] })
assert.strictEqual(selfCtx.hostStoryId, HOST, 'story is its own host')
assert.strictEqual(selfCtx.checklist.items[0].title, 'Host demo', 'empty title falls back to the demo name')
assert.strictEqual(selfCtx.checklist.title, 'Hi Acme', 'variables substituted')
assert.strictEqual(selfCtx.progress, null, 'no token, no progress')
assert.strictEqual(selfCtx.persistProgress, true)
const taskCtx = await getChecklistContext(Models, task, { hostId: HOST, token: TOKEN })
assert.strictEqual(taskCtx.hostStoryId, HOST, 'host via ?checklist=')
assert.deepStrictEqual(taskCtx.progress.completedItemIds, [ITEM_A], 'progress for the matching host + version')
assert.strictEqual(await getChecklistContext(Models, task, { hostId: FOREIGN }), null, 'foreign-workspace host ignored')
assert.strictEqual(await getChecklistContext(Models, task, { hostId: HOST, hide: true }), null, 'hideChecklist')
assert.strictEqual(await getChecklistContext(Models, { ...host, custom: { checklist: { ...checklist, isActive: false } } }, {}), null, 'inactive checklist')
progressDocs[0].checklistVersion = 1
assert.strictEqual((await getChecklistContext(Models, task, { hostId: HOST, token: TOKEN })).progress, null, 'stale version progress dropped')
assert.strictEqual((await getChecklistContext(Models, host, { token: TOKEN, isEditor: true })).persistProgress, false, 'editor never persists')
task.deletedAt = new Date()
assert.strictEqual((await getChecklistContext(Models, host, {})).checklist.items.length, 1, 'deleted task hidden')
delete task.deletedAt
assert.ok(!configJson({ t: '</script>' }).includes('</script>'), 'config JSON cannot close the script tag')

// applyProgressEvents
const fresh = () => ({ startTimestamp: 1, path: [], completedItemIds: [], convertedItemIds: [], state: 'closed', firstOpenedAt: null, completedAt: null, convertedAt: null })
let p = fresh()
applyProgressEvents(p, checklist.items, [{ type: 'item_complete', itemId: ITEM_B }, { type: 'item_complete', itemId: 'nope' }], { storyId: TASK, sessionStoryId: null, now: 10 })
assert.deepStrictEqual(p.completedItemIds, [], 'item_complete without a matching Session rejected, unknown item ignored')
applyProgressEvents(p, checklist.items, [{ type: 'item_complete', itemId: ITEM_B }], { storyId: HOST, sessionStoryId: HOST, now: 10 })
assert.deepStrictEqual(p.completedItemIds, [], 'session of another story does not complete the task')
applyProgressEvents(p, checklist.items, [{ type: 'item_open', itemId: ITEM_B }, { type: 'item_complete', itemId: ITEM_B, at: 9 }, { type: 'state', state: 'open', at: 8 }], { storyId: TASK, sessionStoryId: TASK, now: 10 })
assert.deepStrictEqual(p.completedItemIds, [ITEM_B])
assert.strictEqual(p.path[0].completedAt, 9, 'journey entry completed')
assert.strictEqual(p.firstOpenedAt, 8, 'first open recorded')
const done = applyProgressEvents(p, checklist.items, [{ type: 'item_complete', itemId: ITEM_A }], { storyId: HOST, sessionStoryId: HOST, now: 20 })
assert.ok(done.completedNow && p.completedAt === 20, 'all items done sets completedAt')
assert.ok(!applyProgressEvents(p, checklist.items, [{ type: 'item_complete', itemId: ITEM_A }], { storyId: HOST, sessionStoryId: HOST, now: 30 }).completedNow && p.completedAt === 20, 'completedAt set once')
p = fresh()
applyProgressEvents(p, checklist.items, Array.from({ length: 300 }, () => ({ type: 'item_open', itemId: ITEM_A })), { storyId: HOST, now: 10 })
assert.strictEqual(p.path.length, 50, 'batch capped at 50 events')

// copyChecklist: self-reference follows the clone, foreign items dropped
const NEW = '999999999999999999999999'
const copied = await copyChecklist(Models, { items: [...checklist.items, item(FOREIGN)] }, { oldStoryId: HOST, newStoryId: NEW, workspaceId: WS })
assert.deepStrictEqual(copied.items.map(i => String(i.clickAction.storyId)), [NEW, TASK], 'self remapped, task kept, foreign dropped')

logger.info('checklist.check.js: all checks passed', { eventName: 'CHECKLIST_CHECK_JS_ALL_CHECKS_PASSED' })
