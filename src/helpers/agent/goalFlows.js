// Goal flows: the one outcome an agent steers every conversation toward
// (book a meeting, start a trial, or none). Pure: no DB, no network — see goalFlows.check.js.
//
// Split of work:
//   - the prompt section (goalPromptLines) tells the model the current stage,
//     its offer budget and how to report the visitor's stance (goal_signal)
//   - decide() is the deterministic policy: whether a CTA is shown this turn,
//     whether the inline calendar opens by itself, caps, cooldowns, back-off
//   - resolveCta (validateActions.js) still owns the URL and the qualification gate

import { missingFields } from './qualification.js'
import { isBookingGated } from './validateActions.js'

export const FLOW_KEYS = ['none', 'book_meeting', 'start_trial', 'educate']
export const INTENSITIES = ['soft', 'balanced', 'assertive']
export const GOAL_SIGNALS = ['none', 'high_intent', 'accepted', 'declined']

// Intensity fills every trigger the author left empty
export const PRESETS = {
  soft: { afterTurns: 4, maxAsks: 1, cooldownTurns: 4 },
  balanced: { afterTurns: 2, maxAsks: 2, cooldownTurns: 3 },
  assertive: { afterTurns: 1, maxAsks: 3, cooldownTurns: 2 },
}

const LIMITS = {
  afterTurns: [1, 20],
  maxAsks: [1, 5],
  cooldownTurns: [1, 10],
}
const INSTRUCTIONS_MAX = 500
const STAGE_INSTRUCTIONS_MAX = 400
// Two "not now"s end proactive offers for the session
const MAX_DECLINES = 2

const TONE = {
  soft: 'Mention the next step at most once, and only when it clearly fits what the visitor just said.',
  balanced: 'When a reply naturally leads somewhere, steer toward the next step in one short sentence.',
  assertive: 'End most replies with a short, confident bridge toward the next step — helpful, never pushy or repetitive.',
}

const STAGE = {
  discover: { key: 'discover', label: 'Discover', summary: 'Learn what the visitor wants to achieve', guide: 'Learn what the visitor is trying to achieve. Answer first, then ask one question about their goal.' },
  demo: { key: 'demo', label: 'Show the product', summary: 'Show the demo steps that match their goal', guide: 'Connect the product to their goal and show the matching demo step when it helps.' },
  qualify: { key: 'qualify', label: 'Qualify', summary: 'Ask the qualification questions', guide: 'Before offering a call, learn the missing qualification facts listed below — one question per reply, after answering.' },
  nurture: { key: 'nurture', label: 'Keep helping', summary: 'Visitor said not now — keep helping', guide: 'The visitor said not now. Keep helping and do not offer again unless they bring it up.' },
}

// `edges` drive the editor diagram. {afterTurns} etc. are filled from the agent's policy.
export const FLOWS = {
  none: {
    key: 'none',
    label: 'No goal',
    description: 'Answers questions. Shows your links only when the visitor asks.',
    push: false,
    cta: null,
    stages: [],
    edges: [],
  },
  educate: {
    key: 'educate',
    label: 'Just answer',
    description: 'A product guide. Never pushes a next step.',
    push: false,
    cta: null,
    stages: [STAGE.discover, STAGE.demo],
    edges: [{ from: 'discover', to: 'demo', label: 'Wants to see it' }],
  },
  book_meeting: {
    key: 'book_meeting',
    label: 'Book a meeting',
    description: 'Steers every conversation toward a call and opens your calendar.',
    goalText: 'booking a call with the team',
    push: true,
    cta: 'book_meeting',
    urlField: 'bookMeetingUrl',
    stages: [
      STAGE.discover,
      STAGE.demo,
      { ...STAGE.qualify, optional: 'qualification' },
      {
        key: 'offer',
        label: 'Offer a meeting',
        summary: 'Bridge to a call and show the calendar',
        guide: 'Bridge to a call: tie what they need to what a call gets them (a walkthrough of their setup, pricing for their case, answers from the team). To show the calendar set respond.cta = book_meeting.',
      },
      STAGE.nurture,
      { key: 'done', label: 'Meeting booked', summary: 'Help them prepare for the call', guide: 'The visitor booked a call. Help them prepare: answer questions and suggest what to bring. Do not offer another call.', terminal: true },
    ],
    edges: [
      { from: 'discover', to: 'demo', label: 'Shares a goal' },
      { from: 'demo', to: 'qualify', label: 'After {afterTurns} messages', optional: 'qualification' },
      { from: 'qualify', to: 'offer', label: 'Qualified', optional: 'qualification' },
      { from: 'demo', to: 'offer', label: 'After {afterTurns} messages or a buying signal' },
      { from: 'offer', to: 'done', label: 'Books a time' },
      { from: 'offer', to: 'nurture', label: 'Says not now' },
      { from: 'nurture', to: 'offer', label: 'Asks again' },
    ],
  },
  start_trial: {
    key: 'start_trial',
    label: 'Start a trial',
    description: 'Gets visitors to try the product themselves.',
    goalText: 'starting a free trial',
    push: true,
    cta: 'start_trial',
    urlField: 'startTrialUrl',
    stages: [
      STAGE.discover,
      STAGE.demo,
      {
        key: 'offer',
        label: 'Invite to try it',
        summary: 'Invite them to sign up',
        guide: 'Invite them to try it themselves: tie their goal to what they can do in the first minutes. To show the signup button set respond.cta = start_trial.',
      },
      STAGE.nurture,
      { key: 'done', label: 'Trial started', summary: 'Help them get started', guide: 'The visitor opened the signup. Help them get started and answer setup questions. Do not offer the trial again.', terminal: true },
    ],
    edges: [
      { from: 'discover', to: 'demo', label: 'Shares a goal' },
      { from: 'demo', to: 'offer', label: 'After {afterTurns} messages or a buying signal' },
      { from: 'offer', to: 'done', label: 'Opens signup' },
      { from: 'offer', to: 'nurture', label: 'Says not now' },
      { from: 'nurture', to: 'offer', label: 'Asks again' },
    ],
  },
}

const clip = (value, max) => String(value == null ? '' : value).trim().slice(0, max)

function bad(message) {
  const error = new Error(message)
  error.isValidation = true
  throw error
}

function clampOrNull(value, [min, max]) {
  if (value === null || value === undefined || value === '') return null
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return null
  return Math.min(Math.max(n, min), max)
}

// PATCH body.goal -> stored shape. Throws error.isValidation on bad input.
export function normalizeGoal(input) {
  if (!input || typeof input !== 'object') bad('goal must be an object')
  const flow = input.flow === undefined ? 'none' : input.flow
  if (!FLOW_KEYS.includes(flow)) bad(`goal.flow must be one of ${FLOW_KEYS.join(', ')}`)
  const intensity = input.intensity === undefined ? 'balanced' : input.intensity
  if (!INTENSITIES.includes(intensity)) bad(`goal.intensity must be one of ${INTENSITIES.join(', ')}`)

  const stageKeys = new Set((FLOWS[flow].stages || []).map(s => s.key))
  const rawStages = input.stageInstructions && typeof input.stageInstructions === 'object' ? input.stageInstructions : {}
  const stageInstructions = {}
  Object.entries(rawStages).forEach(([key, text]) => {
    const value = clip(text, STAGE_INSTRUCTIONS_MAX)
    if (stageKeys.has(key) && value) stageInstructions[key] = value
  })

  return {
    flow,
    intensity,
    afterTurns: clampOrNull(input.afterTurns, LIMITS.afterTurns),
    maxAsks: clampOrNull(input.maxAsks, LIMITS.maxAsks),
    cooldownTurns: clampOrNull(input.cooldownTurns, LIMITS.cooldownTurns),
    onHighIntent: input.onHighIntent !== false,
    onQualified: input.onQualified !== false,
    autoOpenCalendar: input.autoOpenCalendar !== false,
    instructions: clip(input.instructions, INSTRUCTIONS_MAX),
    stageInstructions,
  }
}

// The agent's flow, or `none` when the flow's link is missing (nothing to offer)
export function flowFor(agent) {
  const goal = (agent && agent.goal) || {}
  const flow = FLOWS[goal.flow] || FLOWS.none
  if (flow.urlField && !(agent.cta && agent.cta[flow.urlField])) return FLOWS.none
  return flow
}

export function resolvePolicy(agent) {
  const goal = (agent && agent.goal) || {}
  const intensity = INTENSITIES.includes(goal.intensity) ? goal.intensity : 'balanced'
  const preset = PRESETS[intensity]
  const pick = key => clampOrNull(goal[key], LIMITS[key]) ?? preset[key]
  return {
    intensity,
    afterTurns: pick('afterTurns'),
    maxAsks: pick('maxAsks'),
    cooldownTurns: pick('cooldownTurns'),
    onHighIntent: goal.onHighIntent !== false,
    onQualified: goal.onQualified !== false,
    autoOpenCalendar: goal.autoOpenCalendar !== false,
  }
}

export function goalState(agent, session) {
  const g = (session && session.goal) || {}
  const flow = flowFor(agent)
  return {
    asks: g.asks || 0,
    lastAskTurn: g.lastAskTurn || 0,
    declines: g.declines || 0,
    lastDeclineTurn: g.lastDeclineTurn || 0,
    autoOpened: !!g.calendarAutoOpenedAt,
    completed: !!g.completedAt || (flow.key === 'book_meeting' && !!(session && session.meetingBookedAt)),
  }
}

// 1-based visitor turn for the message being answered (messageCount = user + assistant messages before it)
export function turnNumber(session) {
  return Math.floor(((session && session.messageCount) || 0) / 2) + 1
}

function declineBlocks(state, policy, turn) {
  if (state.declines >= MAX_DECLINES) return true
  return state.declines > 0 && turn - state.lastDeclineTurn < policy.cooldownTurns * 2
}

// May the agent make a proactive offer in this turn?
export function canOffer(state, policy, turn) {
  if (state.completed) return false
  if (state.asks >= policy.maxAsks) return false
  if (turn < policy.afterTurns) return false
  if (state.lastAskTurn && turn - state.lastAskTurn < policy.cooldownTurns) return false
  return !declineBlocks(state, policy, turn)
}

function needsQualification(agent, session) {
  const q = agent.qualification || {}
  return !!q.enabled && !(session && session.qualified) && missingFields(agent, session && session.fields).length > 0
}

// Stage the conversation is in before this turn's answer (prompt + session.goal.stage)
export function currentStage(agent, session, turn) {
  const flow = flowFor(agent)
  if (!flow.stages.length) return null
  const early = turn <= 1 ? 'discover' : 'demo'
  if (!flow.push) return early

  const policy = resolvePolicy(agent)
  const state = goalState(agent, session)
  if (state.completed) return 'done'
  if (declineBlocks(state, policy, turn) || state.asks >= policy.maxAsks) return 'nurture'
  if (turn < policy.afterTurns) return early
  if (flow.key === 'book_meeting' && needsQualification(agent, session)) return 'qualify'
  if (canOffer(state, policy, turn)) return 'offer'
  return 'demo'
}

// `# YOUR GOAL` prompt section. [] when the agent has no pushing flow.
export function goalPromptLines(agent, session, turn) {
  const flow = flowFor(agent)
  if (!flow.push) return []

  const goal = agent.goal || {}
  const policy = resolvePolicy(agent)
  const state = goalState(agent, session)
  const stageKey = currentStage(agent, session, turn)
  const stage = flow.stages.find(s => s.key === stageKey)
  const authorStage = (goal.stageInstructions || {})[stageKey]
  const word = flow.cta === 'book_meeting' ? 'a call' : 'the trial'

  const lines = [`\n# YOUR GOAL: ${flow.label.toUpperCase()}`]
  lines.push(`Your job is to help the visitor, and your success is measured by them ${flow.goalText}. Always answer their question first.`)
  lines.push(TONE[policy.intensity])
  if (stage) lines.push(`Current stage — ${stage.label}: ${stage.guide}${authorStage ? ` Author's note for this stage: ${authorStage}` : ''}`)

  if (!state.completed) {
    lines.push(`Offers made so far: ${state.asks} of ${policy.maxAsks}.${state.lastAskTurn ? ` Last offer was ${turn - state.lastAskTurn} replies ago.` : ''}`)
    if (state.declines) lines.push(`The visitor already declined ${state.declines === 1 ? 'once' : `${state.declines} times`}.`)
    lines.push(canOffer(state, policy, turn)
      ? `You may offer ${word} in this reply when it fits: set respond.cta = ${flow.cta} and invite them in one sentence.`
      : `Do not offer ${word} in this reply unless the visitor asks for it.`)
  }

  lines.push('Set respond.goal_signal from the visitor\'s LAST message: accepted = they ask for ' + word + ' or agree to it; declined = they say no / not now; high_intent = buying signal (pricing, implementation, timeline, team size, comparing vendors, "how do we get started"); otherwise none.')
  lines.push(`If the visitor asks for ${word}, always set respond.cta = ${flow.cta}. If they decline, respect it and keep helping. Never paste links: setting respond.cta shows the button for you.`)
  if (goal.instructions) lines.push(`Author's instructions for this goal: ${goal.instructions}`)
  return lines
}

// Server policy for one turn. Returns null (show nothing), or
// { cta, autoOpen, reason, ask } / { declined: true }.
// signals: { requested: parsed.cta, goalSignal, qualifiedNow, turn }
export function decide(agent, session, signals) {
  const flow = flowFor(agent)
  const { requested, goalSignal, qualifiedNow, turn } = signals || {}
  const wanted = requested === 'book_meeting' || requested === 'start_trial' ? requested : null

  // No pushing flow: today's behaviour — the prompt only lets the model set cta on an explicit ask
  if (!flow.push) {
    return wanted ? { cta: wanted, autoOpen: wanted === 'book_meeting', reason: 'asked', ask: false } : null
  }

  const policy = resolvePolicy(agent)
  const state = goalState(agent, session)

  if (goalSignal === 'declined') return { declined: true }
  if (state.completed) return wanted ? { cta: wanted, autoOpen: false, reason: 'asked', ask: false } : null

  if (goalSignal === 'accepted') {
    return { cta: wanted || flow.cta, autoOpen: policy.autoOpenCalendar, reason: 'accepted', ask: true }
  }
  // The other CTA (e.g. trial inside a meeting flow): a plain button, never counted
  if (wanted && wanted !== flow.cta) return { cta: wanted, autoOpen: false, reason: 'asked', ask: false }

  if (!canOffer(state, policy, turn)) return null
  // Gated + unqualified: the meeting flow qualifies first instead of pushing the trial fallback
  if (flow.cta === 'book_meeting' && isBookingGated(agent, session)) return null

  const trigger = wanted ? 'model'
    : goalSignal === 'high_intent' && policy.onHighIntent ? 'high_intent'
      : qualifiedNow && policy.onQualified ? 'qualified'
        : null
  if (!trigger) return null
  // soft: only the model offers. balanced: the server also offers on qualification. assertive: on any trigger.
  if (trigger !== 'model' && policy.intensity === 'soft') return null
  if (trigger === 'high_intent' && policy.intensity === 'balanced') return null

  const autoOpen = policy.autoOpenCalendar && policy.intensity === 'assertive' && goalSignal === 'high_intent' && !state.autoOpened
  return { cta: flow.cta, autoOpen, reason: trigger, ask: true }
}

// Mongo update for session.goal after the turn. `shown` = the CTA actually went out.
// Dotted paths so it never clobbers goal.completedAt written by an ack.
export function goalSessionUpdate(agent, session, decision, { turn, shown, autoOpened }) {
  const flow = flowFor(agent)
  if (!flow.push) return null
  const $set = {}
  const $inc = {}
  const next = { ...((session && session.goal) || {}) }

  if (decision && decision.declined) {
    $inc['goal.declines'] = 1
    $set['goal.lastDeclineTurn'] = turn
    next.declines = (next.declines || 0) + 1
    next.lastDeclineTurn = turn
  }
  if (decision && decision.ask && shown) {
    $inc['goal.asks'] = 1
    $set['goal.lastAskTurn'] = turn
    next.asks = (next.asks || 0) + 1
    next.lastAskTurn = turn
  }
  if (autoOpened) {
    $set['goal.calendarAutoOpenedAt'] = new Date()
    next.calendarAutoOpenedAt = $set['goal.calendarAutoOpenedAt']
  }
  $set['goal.flow'] = flow.key
  // Stage the next turn starts in, for the sessions UI
  $set['goal.stage'] = currentStage(agent, { ...session, goal: next, messageCount: ((session && session.messageCount) || 0) + 2 }, turn + 1)

  return Object.keys($inc).length ? { $set, $inc } : { $set }
}

// Editor catalog: flows with their diagram, presets, limits
export function flowCatalog() {
  return {
    flows: FLOW_KEYS.map(key => {
      const { goalText, ...flow } = FLOWS[key]
      return {
        ...flow,
        stages: flow.stages.map(({ key: k, label, summary, optional, terminal }) => ({ key: k, label, summary, optional, terminal })),
      }
    }),
    presets: PRESETS,
    limits: LIMITS,
  }
}
