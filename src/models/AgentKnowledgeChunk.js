import mongoose from 'mongoose'

const options = {
  strict: true,
  timestamps: { createdAt: true, updatedAt: false },
}

// The vector collection. One collection for the whole app, every query is
// filtered by agentId + workspaceId. Chunks are never written without both.
//
// Vector Search index "agent_chunks_vector" (768-d cosine on embedding; filter fields
// workspaceId, agentId, sourceType). Created at startup by ensureAgentVectorIndex.js
// when VECTOR_SEARCH=on (MongoDB 8.2+ + mongot, or Atlas). VECTOR_SEARCH=off → Node cosine.
const AgentKnowledgeChunk = new mongoose.Schema({
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiDemoAgent', required: true, index: true },
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  sourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentKnowledgeSource', required: true },

  sourceType: { type: String, enum: ['text', 'file', 'url', 'faq', 'demo', 'site', 'call'] },
  text: { type: String }, // the chunk the LLM actually sees

  embedding: { type: [Number], default: [] }, // gemini-embedding-2, 768 floats

  metadata: {
    title: { type: String },
    demoId: { type: mongoose.Schema.Types.ObjectId },
    screenId: { type: mongoose.Schema.Types.ObjectId },
    stepId: { type: mongoose.Schema.Types.ObjectId },
    stepNumber: { type: Number },
    url: { type: String },
  },
}, options)

// Reindex deletes-then-inserts chunks for one source
AgentKnowledgeChunk.index({ agentId: 1, sourceId: 1 })

export default AgentKnowledgeChunk
