import ENV from '../envServer.js'

// Version history for AiDemoAgent — copy of the storyRevisions.js mechanics,
// new collection, never imports or touches StoryRevision.
//
// Snapshotted: editable agent fields + all AgentKnowledgeSource docs for the agent.
// Not snapshotted: AgentKnowledgeChunk embeddings (reindex on revert), sessions,
// publish state, links.

const MAX_REVISIONS_PER_AGENT =
  Number(ENV.AGENT_REVISIONS_MAX) || Number(ENV.STORY_REVISIONS_MAX) || 1000

// The fields the editor can change. isPublished / links are intentionally absent.
const EDITABLE_FIELDS = [
  'name', 'welcomeMessage', 'starterQuestions', 'systemPrompt', 'avatarUrl',
  'voiceEnabled', 'voiceId', 'avatarsEnabled', 'anamAvatarId', 'anamAvatarModel', 'avatarVoice', 'anamVoiceId',
  'avatarProvider', 'lemonsliceAvatarId', 'avatarVideoUrl', 'theme',
  'visitorCapture', 'cta',
  'allowedDemoIds', 'knowledgeSourceIds', 'defaultDemoId', 'embed',
]

export async function captureAgentPreImage(Models, { agentId, workspaceId }) {
  const agent = await Models.AiDemoAgent.findOne({ _id: agentId, workspaceId, deletedAt: null }).lean()
  if (!agent) return null

  const sources = await Models.AgentKnowledgeSource.find({ agentId }).lean()

  const agentPreImage = EDITABLE_FIELDS.reduce((accum, field) => {
    accum[field] = agent[field]
    return accum
  }, {})

  return { agentId, workspaceId, agentPreImage, sourcesPreImage: sources }
}

export async function recordRevision(Models, payload) {
  await Models.AgentRevision.create({ ...payload, kind: 'undo' })

  // A new edit invalidates the redo branch (linear history)
  await Models.AgentRevision.deleteMany({ agentId: payload.agentId, kind: 'redo' })

  const excess = await Models.AgentRevision.countDocuments({ agentId: payload.agentId, kind: 'undo' })
    - MAX_REVISIONS_PER_AGENT
  if (excess > 0) {
    const oldest = await Models.AgentRevision.find({ agentId: payload.agentId, kind: 'undo' })
      .sort({ _id: 1 }).limit(excess).select('_id').lean()
    await Models.AgentRevision.deleteMany({ _id: { $in: oldest.map(d => d._id) } })
  }
}

// Writes a pre-image back: agent fields verbatim, sources replaced wholesale
// (same _ids, so knowledgeSourceIds keeps matching). Chunks of sources that no
// longer exist are deleted; the caller enqueues a reindex to rebuild the rest.
async function applyRevision(Models, rev) {
  await Models.AiDemoAgent.updateOne({ _id: rev.agentId }, { $set: rev.agentPreImage })

  const restored = rev.sourcesPreImage || []
  await Models.AgentKnowledgeSource.deleteMany({ agentId: rev.agentId })
  if (restored.length) {
    // Raw-collection insert keeps original _ids/timestamps exactly as captured
    await Models.AgentKnowledgeSource.collection.insertMany(restored)
  }

  const restoredIds = restored.map(s => s._id)
  await Models.AgentKnowledgeChunk.deleteMany({
    agentId: rev.agentId,
    sourceId: { $nin: restoredIds },
  })
}

async function popAndApply(Models, { agentId, workspaceId }, fromKind, toKind) {
  const rev = await Models.AgentRevision.findOne({ agentId, kind: fromKind }).sort({ _id: -1 }).lean()
  if (!rev) return null

  // Snapshot CURRENT state first — it becomes the entry on the opposite stack
  const counterPayload = await captureAgentPreImage(Models, { agentId, workspaceId })
  if (counterPayload) {
    await Models.AgentRevision.create({ ...counterPayload, kind: toKind, actionLabel: rev.actionLabel })
  }

  // Apply, THEN consume — crash mid-apply leaves the entry for a retry
  await applyRevision(Models, rev)
  await Models.AgentRevision.deleteOne({ _id: rev._id })

  return rev
}

export const undoOnce = (Models, ids) => popAndApply(Models, ids, 'undo', 'redo')
export const redoOnce = (Models, ids) => popAndApply(Models, ids, 'redo', 'undo')

export async function historyCounts(Models, agentId) {
  const [undoCount, redoCount] = await Promise.all([
    Models.AgentRevision.countDocuments({ agentId, kind: 'undo' }),
    Models.AgentRevision.countDocuments({ agentId, kind: 'redo' }),
  ])

  return { undoCount, redoCount, canUndo: undoCount > 0, canRedo: redoCount > 0 }
}
