import mongoose from 'mongoose'

const options = {
  strict: true,
  timestamps: { createdAt: true, updatedAt: false },
}

// Analogue of SessionEvent — typed events, no rrweb.
const AgentSessionEvent = new mongoose.Schema({
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentSession', index: true },
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace' },
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiDemoAgent' },
  type: {
    type: String,
    enum: [
      'session_started',
      'message_sent',
      'message_answered',
      'suggestion_clicked',
      'demo_opened',
      'step_viewed',
      'cta_clicked',
      'voice_started',
      'voice_completed',
      'session_ended',
      'field_recorded',
      'qualified',
      'calendar_opened',
      'meeting_booked',
      'recap_viewed',
    ],
  },
  timestamp: { type: Number },
  data: {}, // { demoId, stepId, stepNumber, cta, suggestion, ... }
}, options)

export default AgentSessionEvent
