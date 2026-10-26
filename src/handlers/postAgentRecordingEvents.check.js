// Self-check for postAgentRecordingEvents — run: node src/handlers/postAgentRecordingEvents.check.js
// Fails if agent recordings stop landing in a Session { type: 'agent', agentSessionId },
// editor sessions start getting recorded, or the per-IP / per-session caps break.
import assert from 'assert'
import handler from './postAgentRecordingEvents.js'
import isAnalyticsExcludedIp from '../helpers/isAnalyticsExcludedIp.js'

import logger from '../helpers/logger.js'

const lean = value => ({ lean: async () => value })

function fakeModels(agentSession, { exists = false, eventsCount = 0 } = {}) {
  const calls = { upsert: null, inserted: [], update: null }
  const Models = {
    AiDemoAgent: { findOne: async () => ({ _id: 'agent1', workspaceId: 'ws1', isPublished: true }) },
    AgentSession: { findOne: () => lean(agentSession) },
    Session: {
      exists: async () => (exists ? { _id: 'rec1' } : null),
      findOneAndUpdate: (filter, update, opts) => {
        calls.upsert = { filter, update, opts }
        return lean({ _id: 'rec1', eventsCount, ...update.$setOnInsert })
      },
      updateOne: async (filter, update) => { calls.update = { filter, update } },
    },
    SessionEvent: { insertMany: async (docs) => { calls.inserted.push(...docs) } },
  }
  return { Models, calls }
}

async function run(agentSession, events, { ip = '1.1.1.1', ...state } = {}) {
  const { Models, calls } = fakeModels(agentSession, state)
  const res = { statusCode: 0, set() {}, status(code) { this.statusCode = code }, send() {} }
  await handler({ mongo: { Models }, params: { agentId: 'agent1', agentSessionId: 'as1' }, body: { events }, headers: { 'x-forwarded-for': ip } }, res)
  return { res, calls }
}

const published = { _id: 'as1', agentId: 'agent1', mode: 'published', startTimestamp: 500 }
const events = [
  { type: 2, timestamp: 1000, data: {} },
  { type: 3, timestamp: 4000, data: { source: 2, type: 2 } },
]

const ok = await run(published, events)
assert.strictEqual(ok.res.statusCode, 200)
assert.deepStrictEqual(ok.calls.upsert.filter, { type: 'agent', agentSessionId: 'as1' })
assert.strictEqual(ok.calls.upsert.opts.upsert, true)
assert.strictEqual(ok.calls.upsert.update.$setOnInsert.workspaceId, 'ws1')
assert.strictEqual(ok.calls.inserted.length, 2)
assert.ok(ok.calls.inserted.every(e => e.sessionId === 'rec1' && !e.storyId), 'events hang off the agent Session, no story')
assert.strictEqual(ok.calls.inserted[1].eventData.data, JSON.stringify({ source: 2, type: 2 }))
assert.deepStrictEqual(ok.calls.update.update, { $set: { endTimestamp: 4000, duration: 3500 }, $inc: { eventsClickCount: 1, eventsCount: 2 } })

const editor = await run({ _id: 'as1', agentId: 'agent1', mode: 'editor' }, events)
assert.strictEqual(editor.res.statusCode, 400, 'editor sessions must not be recorded')
assert.strictEqual(editor.calls.inserted.length, 0)

const missing = await run(null, events)
assert.strictEqual(missing.res.statusCode, 404)

// Workspace analyticsExcludedIps: postAgentSession flags the session, nothing gets stored
const excluded = await run({ ...published, recordingDisabled: true }, events)
assert.strictEqual(excluded.res.statusCode, 403, 'IP-excluded sessions must not be recorded')
assert.strictEqual(excluded.calls.inserted.length, 0)
const workspaceWith = ips => ({ Workspace: { findOne: () => lean({ analyticsExcludedIps: ips }) } })
assert.strictEqual(await isAnalyticsExcludedIp('5.5.5.5', workspaceWith(['5.5.5.5']), 'ws1'), true)
assert.strictEqual(await isAnalyticsExcludedIp('5.5.5.6', workspaceWith(['5.5.5.5']), 'ws1'), false)
assert.strictEqual(await isAnalyticsExcludedIp('5.5.5.5', workspaceWith(undefined), 'ws1'), false, 'no list = feature off')
assert.strictEqual(await isAnalyticsExcludedIp('', workspaceWith(['']), 'ws1'), false, 'unknown IP is never excluded')

// 1000 events per session: truncate the batch that crosses it, reject after
const nearCap = await run(published, events, { exists: true, eventsCount: 999 })
assert.strictEqual(nearCap.res.statusCode, 200)
assert.strictEqual(nearCap.calls.inserted.length, 1)
const atCap = await run(published, events, { exists: true, eventsCount: 1000 })
assert.strictEqual(atCap.res.statusCode, 429)
assert.strictEqual(atCap.calls.inserted.length, 0)

// 5 new recordings per IP per hour; flushes to an existing recording don't count
for (let i = 0; i < 5; i++) {
  assert.strictEqual((await run(published, events, { ip: '9.9.9.9' })).res.statusCode, 200)
}
assert.strictEqual((await run(published, events, { ip: '9.9.9.9' })).res.statusCode, 429, '6th new recording from one IP')
assert.strictEqual((await run(published, events, { ip: '9.9.9.9', exists: true })).res.statusCode, 200, 'existing recording keeps flushing')
assert.strictEqual((await run(published, events, { ip: '8.8.8.8' })).res.statusCode, 200, 'other IPs unaffected')

logger.info('postAgentRecordingEvents.check OK', { eventName: 'POSTAGENTRECORDINGEVENTS_CHECK_OK' })
process.exit(0)
