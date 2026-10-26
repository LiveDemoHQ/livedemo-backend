// Self-check for the agent tool loop. Run: node src/helpers/agent/agentLoop.check.js
import assert from 'assert'
import { MAX_TOOL_ROUNDS, makeToolExecutors, runToolLoop } from './agentTools.js'

import logger from '../logger.js'

const call = (name, args) => ({ name, args, id: `${name}-id` })
const reply = calls => ({ functionCalls: calls, candidates: [{ content: { role: 'model', parts: calls.map(c => ({ functionCall: c })) } }] })

// --- search then respond ------------------------------------------------------
{
  const seen = []
  const script = [
    reply([call('search_knowledge', { query: 'sso for teams' })]),
    reply([call('respond', { answer: 'Yes, SSO is on Teams.', suggestions: ['Pricing?'] })]),
  ]
  const parsed = await runToolLoop({
    prompt: 'p',
    generateStep: async (contents, opts) => { seen.push({ len: contents.length, opts }); return script.shift() },
    exec: { search_knowledge: async ({ query }) => ({ results: [{ text: `hit for ${query}` }] }) },
  })
  assert.strictEqual(parsed.answer, 'Yes, SSO is on Teams.')
  assert.strictEqual(seen.length, 2)
  assert.strictEqual(seen[1].len, 3, 'prompt + model turn + functionResponse')
}

// --- endless searching is capped, last round forced to respond ----------------
{
  const seen = []
  const parsed = await runToolLoop({
    prompt: 'p',
    generateStep: async (contents, opts) => {
      seen.push(opts.allowedFunctionNames)
      return opts.allowedFunctionNames.length === 1
        ? reply([call('respond', { answer: 'forced' })])
        : reply([call('search_knowledge', { query: 'again' })])
    },
    exec: { search_knowledge: async () => ({ results: [] }) },
  })
  assert.strictEqual(seen.length, MAX_TOOL_ROUNDS)
  assert.deepStrictEqual(seen[seen.length - 1], ['respond'])
  assert.strictEqual(parsed.answer, 'forced')
}

// --- tool errors go back to the model instead of throwing ---------------------
{
  let toolResponse
  const script = [
    reply([call('search_knowledge', { query: 'x' })]),
    reply([call('respond', { answer: 'ok' })]),
  ]
  await runToolLoop({
    prompt: 'p',
    generateStep: async (contents) => { toolResponse = contents[2]; return script.shift() },
    exec: { search_knowledge: async () => { throw new Error('boom') } },
  })
  assert.deepStrictEqual(toolResponse.parts[0].functionResponse.response, { error: 'boom' })
}

// --- text fallback when the model skips function calls ------------------------
{
  const parsed = await runToolLoop({ prompt: 'p', generateStep: async () => ({ text: 'plain answer' }), exec: {} })
  assert.strictEqual(parsed.answer, 'plain answer')
}

// --- executors: scope + allow-list + dedupe -----------------------------------
{
  const agent = { _id: 'a1', workspaceId: 'w1' }
  let storyQueried = false
  const Models = { Story: { findOne: () => { storyQueried = true } } }
  let retrieveArgs
  const retrieve = async (M, args) => {
    retrieveArgs = args
    return {
      knowledge: [{ _id: 'k1', text: 'seen already' }, { _id: 'k2', text: 'new fact' }],
      demoCandidates: [{ _id: 'd1', text: 'step', metadata: { demoId: 'demo1', stepId: 's1', stepNumber: 4 } }],
    }
  }
  const demoHits = []
  const exec = makeToolExecutors(Models, {
    agent, allowedDemos: [{ _id: 'demo1', name: 'Demo' }], seenChunkIds: new Set(['k1']), demoHits, retrieve,
  })

  const res = await exec.search_knowledge({ query: 'q', agentId: 'other', workspaceId: 'other' })
  assert.strictEqual(retrieveArgs.agent, agent, 'scope from closure, not args')
  assert.deepStrictEqual(res.results.map(r => r.text), ['new fact', 'step'])
  assert.strictEqual(res.results[1].stepNumber, 4)
  assert.strictEqual(demoHits[0].metadata.stepId, 's1', 'demo hits keep stepId for resolveDemoAction')

  const again = await exec.search_knowledge({ query: 'q' })
  assert.deepStrictEqual(again.results, [], 'already-seen chunks not resent')

  assert.deepStrictEqual(await exec.get_demo_steps({ demoId: 'evil' }), { error: 'demo not in allowed list' })
  assert.strictEqual(storyQueried, false)
}

logger.info('agentLoop.check OK', { eventName: 'AGENTLOOP_CHECK_OK' })
