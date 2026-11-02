// Self-check for goal flows. Run: node src/helpers/agent/goalFlows.check.js
import assert from 'assert'
import {
  canOffer, currentStage, decide, flowFor, goalPromptLines, goalSessionUpdate,
  goalState, normalizeGoal, resolvePolicy, turnNumber,
} from './goalFlows.js'
import { AGENT_TEMPLATES } from './agentTemplates.js'
import { normalizeQualification } from './qualification.js'

const agentWith = (goal, extra = {}) => ({
  cta: { bookMeetingUrl: 'https://calendly.com/acme/demo', startTrialUrl: 'https://app.acme.com/signup' },
  goal,
  ...extra,
})
const session = (goal = {}, extra = {}) => ({ messageCount: 0, goal, ...extra })

// --- normalize --------------------------------------------------------------
{
  const g = normalizeGoal({ flow: 'book_meeting', intensity: 'assertive', maxAsks: 99, afterTurns: '', stageInstructions: { offer: ' Mention the audit ', bogus: 'x' } })
  assert.strictEqual(g.maxAsks, 5, 'clamped')
  assert.strictEqual(g.afterTurns, null, 'empty = preset')
  assert.deepStrictEqual(g.stageInstructions, { offer: 'Mention the audit' }, 'unknown stages dropped')
  assert.throws(() => normalizeGoal({ flow: 'sell_hard' }), e => e.isValidation)
  assert.throws(() => normalizeGoal({ intensity: 'max' }), e => e.isValidation)
}

// --- flow + policy fallbacks ----------------------------------------------------
{
  assert.strictEqual(flowFor({}).key, 'none', 'old agents: no goal')
  assert.strictEqual(flowFor({ goal: { flow: 'book_meeting' }, cta: {} }).key, 'none', 'no link = nothing to push')
  const p = resolvePolicy(agentWith({ flow: 'book_meeting', intensity: 'soft', maxAsks: 3 }))
  assert.deepStrictEqual([p.afterTurns, p.maxAsks, p.cooldownTurns], [4, 3, 4], 'preset + override')
  assert.strictEqual(turnNumber({ messageCount: 4 }), 3)
}

// --- legacy (no flow): CTA only when the model sets it, meeting auto-opens -------
{
  const agent = agentWith(undefined)
  assert.strictEqual(decide(agent, session(), { turn: 1 }), null)
  assert.deepStrictEqual(decide(agent, session(), { requested: 'book_meeting', turn: 1 }), { cta: 'book_meeting', autoOpen: true, reason: 'asked', ask: false })
  assert.deepStrictEqual(goalPromptLines(agent, session(), 1), [])
  assert.strictEqual(goalSessionUpdate(agent, session(), null, { turn: 1 }), null)
}

// --- balanced meeting flow ----------------------------------------------------
{
  const agent = agentWith({ flow: 'book_meeting', intensity: 'balanced' })
  // too early (afterTurns 2)
  assert.strictEqual(decide(agent, session(), { requested: 'book_meeting', turn: 1 }), null)
  // explicit yes beats every cap and opens the calendar
  assert.deepStrictEqual(decide(agent, session({ asks: 9 }), { goalSignal: 'accepted', turn: 1 }), { cta: 'book_meeting', autoOpen: true, reason: 'accepted', ask: true })
  // model offers on time: button only
  assert.deepStrictEqual(decide(agent, session(), { requested: 'book_meeting', turn: 2 }), { cta: 'book_meeting', autoOpen: false, reason: 'model', ask: true })
  // balanced does not force on buying signals ...
  assert.strictEqual(decide(agent, session(), { goalSignal: 'high_intent', turn: 3 }), null)
  // ... but does right after the visitor qualifies
  assert.strictEqual(decide(agent, session(), { qualifiedNow: true, turn: 3 }).reason, 'qualified')
  // cooldown (3) after an offer at turn 2
  assert.strictEqual(decide(agent, session({ asks: 1, lastAskTurn: 2 }), { requested: 'book_meeting', turn: 4 }), null)
  assert.ok(decide(agent, session({ asks: 1, lastAskTurn: 2 }), { requested: 'book_meeting', turn: 5 }))
  // cap (2)
  assert.strictEqual(decide(agent, session({ asks: 2, lastAskTurn: 1 }), { requested: 'book_meeting', turn: 9 }), null)
  // decline: counted, and blocks offers for cooldown*2 turns
  assert.deepStrictEqual(decide(agent, session(), { goalSignal: 'declined', requested: 'book_meeting', turn: 3 }), { declined: true })
  assert.strictEqual(decide(agent, session({ declines: 1, lastDeclineTurn: 3 }), { requested: 'book_meeting', turn: 8 }), null)
  assert.ok(decide(agent, session({ declines: 1, lastDeclineTurn: 3 }), { requested: 'book_meeting', turn: 9 }))
  assert.strictEqual(decide(agent, session({ declines: 2, lastDeclineTurn: 1 }), { requested: 'book_meeting', turn: 20 }), null, 'two noes = done pushing')
  // trial inside a meeting flow is a plain, uncounted button
  assert.deepStrictEqual(decide(agent, session(), { requested: 'start_trial', turn: 1 }), { cta: 'start_trial', autoOpen: false, reason: 'asked', ask: false })
  // booked: never push again, button only if asked
  const booked = session({}, { meetingBookedAt: new Date() })
  assert.strictEqual(goalState(agent, booked).completed, true)
  assert.strictEqual(decide(agent, booked, { goalSignal: 'high_intent', turn: 5 }), null)
  assert.strictEqual(decide(agent, booked, { requested: 'book_meeting', turn: 5 }).autoOpen, false)
  assert.strictEqual(currentStage(agent, booked, 5), 'done')
}

// --- assertive: forces on buying signals, auto-opens once -------------------------
{
  const agent = agentWith({ flow: 'book_meeting', intensity: 'assertive' })
  assert.deepStrictEqual(decide(agent, session(), { goalSignal: 'high_intent', turn: 1 }), { cta: 'book_meeting', autoOpen: true, reason: 'high_intent', ask: true })
  assert.strictEqual(decide(agent, session({ calendarAutoOpenedAt: new Date() }), { goalSignal: 'high_intent', turn: 1 }).autoOpen, false)
  const noAuto = agentWith({ flow: 'book_meeting', intensity: 'assertive', autoOpenCalendar: false })
  assert.strictEqual(decide(noAuto, session(), { goalSignal: 'accepted', turn: 1 }).autoOpen, false)
  const noIntent = agentWith({ flow: 'book_meeting', intensity: 'assertive', onHighIntent: false })
  assert.strictEqual(decide(noIntent, session(), { goalSignal: 'high_intent', turn: 1 }), null)
}

// --- soft: never forces -------------------------------------------------------
{
  const agent = agentWith({ flow: 'book_meeting', intensity: 'soft' })
  assert.strictEqual(decide(agent, session(), { qualifiedNow: true, turn: 6 }), null)
  assert.ok(decide(agent, session(), { requested: 'book_meeting', turn: 6 }))
}

// --- qualification gate: qualify first, no proactive trial fallback ---------------
{
  const qualification = normalizeQualification({ enabled: true, gateBooking: true, fields: [{ label: 'Team size', type: 'number', rule: { op: 'gte', value: 10 } }] })
  const agent = agentWith({ flow: 'book_meeting', intensity: 'assertive' }, { qualification })
  assert.strictEqual(decide(agent, session(), { goalSignal: 'high_intent', turn: 3 }), null)
  assert.strictEqual(currentStage(agent, session(), 3), 'qualify')
  const qualified = session({}, { qualified: true, fields: { team_size: { value: 20 } } })
  assert.strictEqual(currentStage(agent, qualified, 3), 'offer')
  assert.ok(decide(agent, qualified, { goalSignal: 'high_intent', turn: 3 }))
}

// --- stages + prompt ------------------------------------------------------------
{
  const agent = agentWith({ flow: 'book_meeting', intensity: 'balanced', instructions: 'Mention the free audit.', stageInstructions: { offer: 'Calls are 20 minutes.' } })
  assert.strictEqual(currentStage(agent, session(), 1), 'discover')
  assert.strictEqual(currentStage(agent, session(), 2), 'offer')
  assert.strictEqual(currentStage(agent, session({ asks: 2 }), 6), 'nurture')
  assert.strictEqual(currentStage(agentWith({ flow: 'educate' }), session(), 3), 'demo')
  const prompt = goalPromptLines(agent, session({ asks: 1, lastAskTurn: 1, declines: 1, lastDeclineTurn: 1 }), 9).join('\n')
  assert.ok(prompt.includes('# YOUR GOAL: BOOK A MEETING'))
  assert.ok(prompt.includes('Offers made so far: 1 of 2.'))
  assert.ok(prompt.includes('declined once'))
  assert.ok(prompt.includes('Calls are 20 minutes.'))
  assert.ok(prompt.includes('Mention the free audit.'))
  assert.ok(goalPromptLines(agent, session(), 1).join('\n').includes('Do not offer a call in this reply'))
  assert.ok(goalPromptLines(agent, session(), 2).join('\n').includes('You may offer a call in this reply'))
}

// --- session update ------------------------------------------------------------
{
  const agent = agentWith({ flow: 'book_meeting' })
  const offered = goalSessionUpdate(agent, session(), { cta: 'book_meeting', ask: true }, { turn: 2, shown: true, autoOpened: true })
  assert.deepStrictEqual(offered.$inc, { 'goal.asks': 1 })
  assert.strictEqual(offered.$set['goal.lastAskTurn'], 2)
  assert.ok(offered.$set['goal.calendarAutoOpenedAt'] instanceof Date)
  assert.ok(!('goal.completedAt' in offered.$set), 'never clobbers the ack')
  const notShown = goalSessionUpdate(agent, session(), { cta: 'book_meeting', ask: true }, { turn: 2, shown: false })
  assert.ok(!notShown.$inc, 'gate dropped the CTA: not an ask')
  const declined = goalSessionUpdate(agent, session(), { declined: true }, { turn: 3 })
  assert.deepStrictEqual(declined.$inc, { 'goal.declines': 1 })
  assert.strictEqual(canOffer(goalState(agent, session()), resolvePolicy(agent), 2), true)
}

// --- every template normalizes --------------------------------------------------
AGENT_TEMPLATES.forEach((t) => {
  normalizeGoal(t.config.goal)
  if (t.config.qualification) normalizeQualification(t.config.qualification)
})

console.log('goalFlows.check: ok')
