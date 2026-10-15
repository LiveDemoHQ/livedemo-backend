import mongoose from 'mongoose'

const options = {
  strict: true,
  timestamps: { createdAt: true, updatedAt: true },
}

// A knowledge source belongs to exactly one AiDemoAgent. There is no
// workspace-global knowledge pool. Chunks are derived, never edited by hand.
const AgentKnowledgeSource = new mongoose.Schema({
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiDemoAgent', required: true, index: true },
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },

  // site = crawled website (many pages), call = sales-call transcript (text)
  type: { type: String, enum: ['text', 'file', 'url', 'faq', 'demo', 'site', 'call'] },
  title: { type: String, default: '' },

  // text / faq / call (and extracted file/url text — see postAgentKnowledge)
  rawText: { type: String, default: '' },

  // file
  fileUrl: { type: String, default: '' },
  fileName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  fileBase64: { type: String, default: '' }, // PDF kept for native gemini-embedding-2 reindex
  pageCount: { type: Number, default: 0 },

  // url / site (site: the root URL the crawl starts from)
  url: { type: String, default: '' },

  // site: crawl limits + what the last crawl extracted (hash = skip unchanged pages)
  maxPages: { type: Number, default: 25 },
  refreshHours: { type: Number, default: 24 }, // url + site re-crawl interval, 0 = never
  lastCrawledAt: { type: Date, default: null },
  pages: [{
    _id: false,
    url: String,
    title: String,
    chars: Number,
    hash: String,
  }],

  // demo (auto-generated from a Story — not user-uploaded)
  demoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Story' },

  status: { type: String, enum: ['pending', 'indexing', 'ready', 'error'], default: 'pending' },
  errorMessage: { type: String, default: '' },
  chunkCount: { type: Number, default: 0 },
  enabled: { type: Boolean, default: true },
}, options)

export default AgentKnowledgeSource
