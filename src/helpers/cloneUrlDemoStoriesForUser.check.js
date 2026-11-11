// Self-check for the agent branch of the UrlDemo clone. Run: node src/helpers/cloneUrlDemoStoriesForUser.check.js
// cloneAgentForUser is injected: its own behaviour is covered by the "Make it yours" checks
import assert from 'assert'
import { cloneUrlDemoAgentForUser } from './cloneUrlDemoStoriesForUser.js'
import { newCloneCtx } from './own/cloneForClaim.js'

import logger from './logger.js'

const SOURCE_AGENT = 'a00000000000000000000001'
const SOURCE_STORY = 'b00000000000000000000001'
const NEW_AGENT = 'a00000000000000000000002'
const NEW_STORY = 'b00000000000000000000002'
const USER = 'c00000000000000000000001'
const CTA = { bookMeetingUrl: 'https://cal.com/x/20min', startTrialUrl: 'https://example.com', inlineCalendar: true }

const setup = ({ sourceAgent, mapStory = true } = {}) => {
    const state = { agentUpdates: [], savedUrlDemos: [], ctxArgs: null, cloneOptions: null, rolledBack: 0 }
    function UrlDemo(doc) {
        this.doc = doc
    }
    UrlDemo.prototype.save = async function () {
        state.savedUrlDemos.push(this.doc)
        return this.doc
    }
    const Models = {
        UrlDemo,
        AiDemoAgent: {
            findOne: () => ({ select: () => ({ lean: async () => sourceAgent }) }),
            updateOne: async (filter, update) => state.agentUpdates.push({ filter, update })
        }
    }
    const deps = {
        newCloneCtx: (args) => {
            state.ctxArgs = args
            return newCloneCtx(args)
        },
        cloneAgentForUser: async (agentId, ctx, options) => {
            state.cloneOptions = options
            if (mapStory) ctx.storyIdMap.set(SOURCE_STORY, NEW_STORY)
            return NEW_AGENT
        },
        finishStoryGraph: async () => {},
        rollbackClaim: async () => {
            state.rolledBack++
        }
    }
    return { Models, deps, state }
}

const sourceUrlDemo = {
    url: 'https://example.com',
    browserSessionId: 'session-1',
    type: 'standard',
    demoType: 'agent',
    storyId: SOURCE_STORY,
    agentId: SOURCE_AGENT
}

// --- the copy: owned row with the user, a new agent and the agent's new story
const ok = setup({ sourceAgent: { _id: SOURCE_AGENT, workspaceId: 'w-default', cta: CTA } })
const owned = await cloneUrlDemoAgentForUser(sourceUrlDemo, USER, 'w-user', '', ok.Models, ok.deps)
assert.deepStrictEqual(owned, {
    url: 'https://example.com',
    browserSessionId: 'session-1',
    type: 'owned',
    demoType: 'agent',
    storyId: NEW_STORY,
    agentId: NEW_AGENT,
    status: 'completed',
    userId: USER
})
assert.notStrictEqual(owned.agentId, SOURCE_AGENT)
assert.notStrictEqual(owned.storyId, SOURCE_STORY)
assert.strictEqual(ok.state.ctxArgs.workspaceId, 'w-user')
assert.strictEqual(ok.state.ctxArgs.sourceWorkspaceId, 'w-default', 'the source workspace is the agent\'s own')
assert.deepStrictEqual(ok.state.cloneOptions, { includeKnowledge: true })
// cloneAgentForUser blanks the CTA links and unpublishes; the copy gets the source's links back and is published
assert.deepStrictEqual(ok.state.agentUpdates, [{ filter: { _id: NEW_AGENT }, update: { $set: { cta: CTA, isPublished: true } } }])
assert.strictEqual(ok.state.rolledBack, 0)

// --- a deleted or missing source agent: nothing is copied
const gone = setup({ sourceAgent: null })
assert.strictEqual(await cloneUrlDemoAgentForUser(sourceUrlDemo, USER, 'w-user', '', gone.Models, gone.deps), null)
assert.strictEqual(gone.state.savedUrlDemos.length, 0)
assert.strictEqual(gone.state.ctxArgs, null)

// --- the UrlDemo's story is not one of the agent's demos: no row, and the partial copy is rolled back
const partial = setup({ sourceAgent: { _id: SOURCE_AGENT, workspaceId: 'w-default', cta: CTA }, mapStory: false })
await assert.rejects(
    cloneUrlDemoAgentForUser(sourceUrlDemo, USER, 'w-user', '', partial.Models, partial.deps),
    /incomplete/
)
assert.strictEqual(partial.state.savedUrlDemos.length, 0)
assert.strictEqual(partial.state.rolledBack, 1)

logger.info('cloneUrlDemoStoriesForUser.check.js: ok', { eventName: 'CLONEURLDEMOSTORIESFORUSER_CHECK_JS_OK' })
