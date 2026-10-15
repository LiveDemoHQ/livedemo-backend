import mongoose from 'mongoose'

// Emails LiveDemo sent to agent visitors on a workspace's behalf (session summary).
// Also the opt-out list: a row with unsubscribedAt blocks further sends to that address in the workspace.
const AgentEmail = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiDemoAgent' },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentSession' },
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
  kind: { type: String, enum: ['session_summary'], default: 'session_summary' },
  to: { type: String, required: true },
  from: { type: String, default: '' },
  subject: { type: String, default: '' },
  html: { type: String, default: '' },
  text: { type: String, default: '' },
  status: { type: String, enum: ['sent', 'failed'], required: true },
  error: { type: String, default: '' },
  messageId: { type: String, default: '' },
  unsubscribeToken: { type: String, required: true, unique: true },
  unsubscribedAt: { type: Date }
}, { timestamps: true })

AgentEmail.index({ workspaceId: 1, createdAt: -1 })
AgentEmail.index({ workspaceId: 1, to: 1, unsubscribedAt: 1 })
AgentEmail.index({ sessionId: 1 })
AgentEmail.index({ leadId: 1 })

export default AgentEmail
