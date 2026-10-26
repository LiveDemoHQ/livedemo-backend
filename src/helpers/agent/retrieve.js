import ENV from '../../envServer.js'
import aiHelpers from '../aiHelpers.js'
import { cosineSim } from './agentKnowledge.js'

import logger from '../logger.js'

let vectorSearchWarned = false

async function cosineRank(Models, { agent, queryVector, enabledSourceIds, limit, sourceType }) {
  const query = {
    agentId: agent._id,
    workspaceId: agent.workspaceId,
    sourceId: { $in: enabledSourceIds },
  }
  if (sourceType) query.sourceType = sourceType

  const chunks = await Models.AgentKnowledgeChunk
    .find(query)
    .select('text sourceType sourceId metadata embedding')
    .lean()

  return chunks
    .map(c => ({ ...c, score: cosineSim(queryVector, c.embedding || []) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ embedding, ...rest }) => rest)
}

function isSearchNotEnabled(err) {
  return err?.code === 31082 || err?.codeName === 'SearchNotEnabled'
}

const KNOWLEDGE_TOP = 5
const DEMOS_TOP = 5
const MIXED_LIMIT = 20

// Retrieval for one chat turn. EVERY path filters by workspaceId + agentId —
// never another workspace's chunks, never another agent's chunks.
// Returns { knowledge: [...], demoCandidates: [...] } (the spec's
// "knowledge top 5 + demos top 5" from one index, split in code).
export default async function retrieve(Models, { agent, queryText, limit = MIXED_LIMIT }) {
  const [queryVector, enabledSources] = await Promise.all([
    aiHelpers.embedText(queryText, {
      taskType: ENV.GEMINI_EMBED_QUERY_TASK || 'QUESTION_ANSWERING',
      live: true,
    }),
    Models.AgentKnowledgeSource
      .find({ agentId: agent._id, enabled: true })
      .select('_id')
      .lean(),
  ])
  const enabledSourceIds = enabledSources.map(s => s._id)

  const rankArgs = { agent, queryVector, enabledSourceIds, limit }
  let ranked = []

  if (ENV.VECTOR_SEARCH === 'off') {
    ranked = await cosineRank(Models, rankArgs)
  } else {
    try {
      ranked = await Models.AgentKnowledgeChunk.aggregate([
        {
          $vectorSearch: {
            index: 'agent_chunks_vector',
            path: 'embedding',
            queryVector,
            numCandidates: 40,
            limit,
            filter: { workspaceId: agent.workspaceId, agentId: agent._id },
          },
        },
        {
          $project: {
            text: 1, sourceType: 1, sourceId: 1, metadata: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ])
      ranked = ranked.filter(c => enabledSourceIds.some(id => String(id) === String(c.sourceId)))
    } catch (err) {
      if (!isSearchNotEnabled(err)) throw err
      if (!vectorSearchWarned) {
        vectorSearchWarned = true
        logger.info('$vectorSearch unavailable (mongot not running). Falling back to Node cosine rank. ' + 'Set VECTOR_SEARCH=off to silence, or install mongot: ' + 'https://www.mongodb.com/docs/search/self-managed/current/installation/linux/', { eventName: 'RETRIEVE' })
      }
      ranked = await cosineRank(Models, rankArgs)
    }
  }

  const knowledge = ranked.filter(c => c.sourceType !== 'demo').slice(0, KNOWLEDGE_TOP)
  let demoCandidates = ranked.filter(c => c.sourceType === 'demo').slice(0, DEMOS_TOP)

  // FAQ/url chunks often crowd the mixed top-N and starve demo steps, so the
  // agent answers in text and never emits content_card. Fill demos separately.
  if (!demoCandidates.length && enabledSourceIds.length) {
    demoCandidates = await cosineRank(Models, {
      agent, queryVector, enabledSourceIds, limit: DEMOS_TOP, sourceType: 'demo',
    })
  }

  return { knowledge, demoCandidates }
}
