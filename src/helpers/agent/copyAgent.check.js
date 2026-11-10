// Self-check for the agent copy payload. Run: node src/helpers/agent/copyAgent.check.js
// Fails if a copy keeps publish state, share links, or "Make it yours" settings.
import assert from 'assert'
import { agentCopyPayload } from './copyAgent.js'

import logger from '../logger.js'

const agent = {
    _id: 'a',
    name: 'Closer',
    workspaceId: 'w',
    userId: 'author',
    isPublished: true,
    welcomeMessage: 'Hi',
    links: ['link'],
    ownable: { enabled: true },
    clonedFrom: { kind: 'agent', id: 'src' },
    knowledgeSourceIds: ['source'],
    deletedAt: null,
    createdAt: 1,
    updatedAt: 2,
    __v: 0,
    cta: { bookMeetingUrl: 'https://cal.com/x' },
    embed: { enabled: true },
    tags: ['sales'],
}

const copy = agentCopyPayload(agent, { userId: 'me' })
assert.equal(copy.name, 'Closer (2)')
assert.equal(copy.userId, 'me')
assert.equal(copy.workspaceId, 'w')
assert.equal(copy.isPublished, false)
assert.equal(copy.welcomeMessage, 'Hi')
assert.equal(copy.cta.bookMeetingUrl, 'https://cal.com/x')
assert.equal(copy.embed.enabled, true)
assert.deepEqual(copy.tags, ['sales'])
assert.deepEqual(copy.links, [])
assert.deepEqual(copy.knowledgeSourceIds, [])
assert.equal(copy.deletedAt, null)
assert.equal(copy._id, undefined)
assert.equal(copy.ownable, undefined)
assert.equal(copy.clonedFrom, undefined)
assert.deepEqual(agent.links, ['link'])

assert.equal(agentCopyPayload(agent, { name: '  Custom  ', userId: 'me' }).name, 'Custom')
assert.equal(agentCopyPayload(agent, { name: '   ', userId: 'me' }).name, 'Closer (2)')
assert.equal(agentCopyPayload({ name: '' }, { userId: 'me' }).name, 'Untitled agent (2)')
assert.equal(agentCopyPayload({ name: 'x'.repeat(200) }, { userId: 'me' }).name.length, 200)

logger.info('copyAgent.check ok', { eventName: 'COPYAGENT_CHECK_OK' })
