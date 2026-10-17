import mongoose from 'mongoose'

const options = {
  strict: true,
  timestamps: { createdAt: true, updatedAt: true },
}

// Analogue of Session.js for agent visits. Never written into Session —
// getWorkspaceSessions groups by storyId and chat visits would break demo numbers.
const AgentSession = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiDemoAgent', required: true, index: true },

  // Editor sessions are excluded from analytics
  mode: { type: String, enum: ['published', 'editor'], default: 'published' },
  // Visitor IP is in the workspace's analyticsExcludedIps: no rrweb replay
  recordingDisabled: { type: Boolean, default: false },

  visitorName: { type: String },
  visitorEmail: { type: String },
  visitorSessionId: { type: String },

  clientIpData: {},

  startTimestamp: { type: Number },
  endTimestamp: { type: Number },
  duration: { type: Number }, // ms, set on hang-up / session_ended

  stage: { type: String, default: 'welcome' }, // welcome | demo | booked | ended
  // Written by the summarizeAgentSession job (processAgentSession.js)
  summary: { type: String },
  // Same conversation written to the visitor ("you asked about…"), only when the agent emails summaries
  visitorSummary: { type: String },
  topics: [String],
  intent: { type: String, enum: ['low', 'medium', 'high'] },
  unanswered: [String],
  summarizedAt: { type: Date },
  summarizedMessageCount: { type: Number, default: 0 },
  finalizeQueuedAt: { type: Date }, // final summary job enqueued (hang-up or idle sweep)
  finalizedAt: { type: Date }, // final summary done + session.ended / HubSpot fired once

  // Qualification answers: { [key]: { value, source, at } } — see helpers/agent/qualification.js
  fields: { type: mongoose.Schema.Types.Mixed, default: {} },
  qualified: { type: Boolean, default: false },
  qualifiedAt: { type: Date },
  meetingBookedAt: { type: Date },

  // {{company}} / {{firstName}} / {{domain}} / {{logo}} values for the demo player
  personalization: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Public recap page /recaps/:recapToken (unguessable, minted with the session)
  recapToken: { type: String, index: true, sparse: true },
  recapViews: { type: Number, default: 0 },
  recapViewerIps: [String],

  currentDemoId: { type: mongoose.Schema.Types.ObjectId },
  currentStepId: { type: mongoose.Schema.Types.ObjectId },
  currentStepNumber: { type: Number, default: 1 },
  viewedDemoIds: [{ type: mongoose.Schema.Types.ObjectId }],

  messageCount: { type: Number, default: 0 },
  demosOpenedCount: { type: Number, default: 0 },
  suggestionClickCount: { type: Number, default: 0 },
  ctaClickCount: { type: Number, default: 0 },

  leadId: { type: mongoose.Schema.Types.ObjectId },

  // Where the visit came from. Client-reported, truncated in postAgentSession.
  source: {
    channel: { type: String, enum: ['link', 'oembed', 'embed'], default: 'link' },
    trigger: { type: String, enum: ['bubble', 'pill', 'pill_mic', 'preview', 'chip', 'button', 'api', 'smartbar', 'auto'] },
    pageUrl: { type: String },
    referrer: { type: String },
    utm: {},
  },
}, options)

AgentSession.index({ workspaceId: 1, startTimestamp: -1 })
AgentSession.index({ agentId: 1, startTimestamp: -1 })

export default AgentSession
