// Server-side validation before any content_card is emitted. The LLM's demo
// choice is never trusted: the story must exist, live in the agent's
// workspace, and be allowed by the agent.

// Stories this agent may open. An explicit allow-list / default demo is the
// author's pick (including drafts — the iframe already loads those). Empty
// list in published mode = every published story in the workspace.
export function allowedDemosQuery(agent, mode) {
  const query = { workspaceId: agent.workspaceId, deletedAt: null }
  const seen = new Set()
  const ids = []
  for (const id of [...(agent.allowedDemoIds || []), agent.defaultDemoId]) {
    if (!id) continue
    const key = String(id)
    if (seen.has(key)) continue
    seen.add(key)
    ids.push(id)
  }
  if (ids.length) query._id = { $in: ids }
  else if (mode === 'published') query.isPublished = true
  return query
}

export async function getAllowedDemos(Models, agent, mode) {
  return Models.Story.find(allowedDemosQuery(agent, mode))
    .select('_id name thumbnailImageUrl isPublished')
    .lean()
}

// Client-reported player position from the chat body. Untrusted: shape-checked
// here; demo access is still enforced by validateDemoAction before any card.
export function parsePlayerState(body) {
  const demoId = String(body?.demoId || '')
  const stepNumber = Number(body?.stepNumber)
  if (!/^[a-f0-9]{24}$/i.test(demoId)) return null
  if (!Number.isInteger(stepNumber) || stepNumber < 1 || stepNumber > 10000) return null
  return { demoId, stepNumber }
}

function isPlaceholderId(value) {
  const s = String(value || '').trim()
  return !s || s === 'null' || /^<|id from the list|untitled/i.test(s)
}

function parseStepNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null
}

const STEP_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
}

function parseStepFromText(text) {
  const m = String(text || '').match(/\bstep\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i)
  if (!m) return null
  return parseStepNumber(m[1]) || STEP_WORDS[m[1].toLowerCase()] || null
}

// Gemini often copies the demo name or omits demoId and only mentions "step 3".
function normalizeParsedAction(raw) {
  if (!raw || typeof raw !== 'object') return null
  const demoId = raw.demoId || raw.demo_id || raw.storyId || raw.demo || raw.id || null
  const stepNumber = parseStepNumber(raw.stepNumber ?? raw.step_number ?? raw.step)
  const narration = String(raw.narration || '').trim()
  if (!narration || (isPlaceholderId(demoId) && stepNumber == null)) return null
  return { demoId: isPlaceholderId(demoId) ? null : demoId, stepNumber, narration }
}

function matchAllowedDemo(idOrName, allowedDemos) {
  if (!idOrName || !allowedDemos?.length) return null
  const needle = String(idOrName).trim().toLowerCase()
  const byId = allowedDemos.find(d => String(d._id) === String(idOrName))
  if (byId) return byId._id
  const byName = allowedDemos.find(d => String(d.name || '').trim().toLowerCase() === needle)
  if (byName) return byName._id
  const byIncludes = allowedDemos.find((d) => {
    const name = String(d.name || '').trim().toLowerCase()
    return name && (name.includes(needle) || needle.includes(name))
  })
  return byIncludes ? byIncludes._id : null
}

function idFromCandidate(meta, allowedDemos) {
  if (!meta?.demoId) return null
  return matchAllowedDemo(meta.demoId, allowedDemos) || (!allowedDemos?.length ? meta.demoId : null)
}

// Only the model decides to navigate, and only with its own narration sentence.
// Retrieved step / "step N" in the answer / session/default demo just repair a
// sloppy action (Gemini names the product instead of the id). Summary chunks have no stepId.
export function resolveDemoAction(parsedAction, demoCandidates, ctx = {}) {
  const action = normalizeParsedAction(parsedAction)
  if (!action) return null
  const stepped = (demoCandidates || []).find(c => c.metadata?.stepId && c.metadata?.demoId)
  const allowed = ctx.allowedDemos || []
  const stepFromText = parseStepFromText(ctx.answer)

  const demoId = (action.demoId && (matchAllowedDemo(action.demoId, allowed) || (!allowed.length && action.demoId)))
    || idFromCandidate(stepped?.metadata, allowed)
    || ctx.currentDemoId
    || ctx.defaultDemoId
    || allowed[0]?._id
    || null

  if (!demoId) return null

  const retrievedStep = stepped ? (stepped.metadata.stepNumber || 1) : null
  let stepNumber = action.stepNumber
  if (stepNumber == null || stepNumber <= 1) {
    stepNumber = retrievedStep || stepFromText || stepNumber || 1
  }

  return { demoId, stepNumber, narration: action.narration }
}

// Model narration becomes the last sentence. Only called once the card is
// actually emitted, so the text never points at a dropped card.
export function appendDemoNarration(answer, narration) {
  const text = String(answer || '').trim()
  const line = String(narration || '').trim()
  if (!line || text.toLowerCase().includes(line.toLowerCase())) return text
  return text ? `${text}\n\n${line}` : line
}

const CALENDAR_RE = /^https:\/\/((www\.)?calendly\.com|(app\.)?cal\.com)\//i

export function isInlineCalendarUrl(url) {
  return CALENDAR_RE.test(String(url || ''))
}

// The model may only *ask* for a CTA; the URL and the qualification gate are
// decided here. Gated + not qualified = trial link (or nothing).
export function resolveCta(agent, session, requested) {
  if (requested !== 'book_meeting' && requested !== 'start_trial') return null
  const cta = agent.cta || {}
  const q = agent.qualification || {}
  const hasCriteria = (q.fields || []).some(f => f.required || (f.rule && f.rule.op))
  const gated = q.enabled && q.gateBooking !== false && hasCriteria && !(session && session.qualified)

  if (requested === 'book_meeting' && cta.bookMeetingUrl && !gated) {
    return {
      type: 'book_meeting',
      url: cta.bookMeetingUrl,
      inline: cta.inlineCalendar !== false && isInlineCalendarUrl(cta.bookMeetingUrl),
    }
  }
  if (cta.startTrialUrl) return { type: 'start_trial', url: cta.startTrialUrl, inline: false }
  return null
}

// Validates a proposed { demoId, stepNumber } action. Returns the story doc
// (with steps counted) or null when the action must be dropped.
// allowedDemos: pass getAllowedDemos() output when already loaded to skip the query.
export async function validateDemoAction(Models, agent, mode, demoId, stepNumber, allowedDemos = null) {
  if (!demoId) return null

  const allowed = allowedDemos || await getAllowedDemos(Models, agent, mode)
  const isAllowed = allowed.some(s => String(s._id) === String(demoId))
  if (!isAllowed) return null

  const story = await Models.Story.findOne({
    _id: demoId,
    workspaceId: agent.workspaceId,
    deletedAt: null,
  })
    .populate({ path: 'screens', select: '_id steps index' })
    .lean()

  if (!story) return null

  const stepsTotal = (story.screens || []).reduce((sum, screen) => sum + (screen.steps || []).length, 0)
  const clampedStep = Math.min(Math.max(Number(stepNumber) || 1, 1), Math.max(stepsTotal, 1))

  return {
    demoId: story._id,
    workspaceId: story.workspaceId,
    name: story.name,
    stepNumber: clampedStep,
    stepsTotal,
  }
}
