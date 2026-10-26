// Self-check for server-side GA4 / Segment payloads — run: node src/helpers/workspaceEvents.check.js
// Fails if lead PII would reach Google / Segment or event names stop matching the player's livedemo_* names.
import assert from 'assert'
import { analyticsEvent, demoPayload } from './workspaceEvents.js'

import logger from './logger.js'

const data = demoPayload({
    story: { _id: 's1', name: 'Onboarding' },
    session: { _id: 'sess1', stepsCount: 5 },
    lead: { _id: 'l1', data: { name: 'Jane', email: 'jane@acme.com' } }
})
const out = analyticsEvent({ id: 'evt_1', type: 'demo.lead', data })

assert.strictEqual(out.name, 'livedemo_demo_lead')
assert.strictEqual(out.clientId, 'sess1')
assert.deepStrictEqual(out.params, { session_id: 'sess1', demo_id: 's1', demo_name: 'Onboarding' })
assert.ok(!JSON.stringify(out).includes('jane'), 'no lead PII')

const agent = analyticsEvent({ id: 'evt_2', type: 'lead.qualified', data: { session: { id: 'a1', agentName: 'Bot', qualified: true }, lead: { email: 'x@y.z' } } })
assert.strictEqual(agent.name, 'livedemo_lead_qualified')
assert.deepStrictEqual(agent.params, { session_id: 'a1', agent_name: 'Bot', qualified: true })

logger.info('workspaceEvents.check: ok', { eventName: 'WORKSPACEEVENTS_CHECK_OK' })
