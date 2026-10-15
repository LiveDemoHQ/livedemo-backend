import mongoose from 'mongoose'

const options = {
  strict: true,
  timestamps: { createdAt: true, updatedAt: true },
}

// A published, shareable workspace object. Sits beside Story, never touches it.
// Access is workspace membership (validateUserHasAccessToWorkspace), not userId.
const AiDemoAgent = new mongoose.Schema({
  name: { type: String },
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // creator only
  isPublished: { type: Boolean, default: false },

  welcomeMessage: { type: String, default: 'Hey, welcome! What brought you here today?' },
  starterQuestions: { type: [String], default: [] },
  systemPrompt: { type: String, default: '' },
  avatarUrl: { type: String, default: '' },
  theme: { type: String, enum: ['light', 'dark', 'dark-blur', 'light-blur'], default: 'light' },

  voiceEnabled: { type: Boolean, default: false },
  voiceId: { type: String, default: '' },
  // Talking Anam face. Off until the author turns it on. Lip-sync still needs a selected avatar.
  avatarsEnabled: { type: Boolean, default: false },
  anamAvatarId: { type: String, default: '' }, // stock Anam avatar UUID
  anamAvatarModel: { type: String, default: '' }, // set server-side from the avatar, e.g. cara-4
  // Who speaks for the face. Brain is Gemini either way (Anam LLM stays off).
  avatarVoice: { type: String, enum: ['elevenlabs', 'anam'], default: 'elevenlabs' },
  anamVoiceId: { type: String, default: '' }, // stock Anam voice UUID, used when avatarVoice === 'anam'
  // Who renders the face. LemonSlice always lip-syncs the ElevenLabs voice (no avatarVoice 'anam').
  avatarProvider: { type: String, enum: ['anam', 'lemonslice'], default: 'anam' },
  lemonsliceAvatarId: { type: String, default: '' }, // id from helpers/agent/lemonslice.js STOCK_AVATARS
  avatarVideoUrl: { type: String, default: '' }, // our CDN copy of the face's short preview clip, '' if none

  // Imported Stories (same workspace). Not copies. Empty = all published stories in the workspace.
  allowedDemoIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Story' }],
  // Opens step 1 on the right when a session starts. Must be allowed (or any published story if list empty).
  defaultDemoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Story', default: null },

  // This agent's knowledge library. Every id must have AgentKnowledgeSource.agentId === this._id.
  knowledgeSourceIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AgentKnowledgeSource' }],

  visitorCapture: {
    enabled: { type: Boolean, default: false },
    requireName: { type: Boolean, default: false },
    requireEmail: { type: Boolean, default: false },
  },

  cta: {
    bookMeetingUrl: { type: String, default: '' },
    startTrialUrl: { type: String, default: '' },
    // Calendly / Cal.com links open inside the demo pane instead of a new tab
    inlineCalendar: { type: Boolean, default: true },
  },

  // Questions the agent asks during the chat. Normalized by helpers/agent/qualification.js
  qualification: {
    enabled: { type: Boolean, default: false },
    // Only qualified visitors get the calendar; everyone else gets startTrialUrl
    gateBooking: { type: Boolean, default: true },
    fields: [{
      _id: false,
      key: { type: String },
      label: { type: String },
      question: { type: String },
      type: { type: String, enum: ['text', 'number', 'select', 'boolean'], default: 'text' },
      options: [String],
      required: { type: Boolean, default: false },
      // Rule this answer must pass to qualify: gte/lte (number), in (select), eq (boolean), any (answered)
      rule: {
        op: { type: String, enum: ['', 'any', 'gte', 'lte', 'eq', 'in'], default: '' },
        value: { type: mongoose.Schema.Types.Mixed },
      },
    }],
  },

  // Public /recaps/:token page offered when a session ends
  recapEnabled: { type: Boolean, default: true },

  // Final summary is written this long after the visitor's last activity (5-60, step 5)
  summaryIdleMinutes: { type: Number, default: 5 },
  // Email the summary to the visitor when the session captured an email. '' subject/body = default template
  summaryEmail: {
    enabled: { type: Boolean, default: false },
    subject: { type: String, default: '' },
    body: { type: String, default: '' },
  },

  // Website embed SDK (livedemo-embed.js). Embedding needs isPublished && embed.enabled.
  embed: {
    enabled: { type: Boolean, default: false },
    launcher: { type: String, enum: ['bubble', 'pill', 'smartbar', 'none'], default: 'pill' },
    position: { type: String, enum: ['right', 'left', 'center'] }, // unset = per launcher: pill center, bubble right
    teaserText: { type: String, default: '' }, // '' = welcomeMessage
    teaserDelayMs: { type: Number, default: 3000 },
    accentColor: { type: String, default: '' }, // #rrggbb, '' = theme default
    allowedDomains: { type: [String], default: [] }, // [] = any site; feeds frame-ancestors
    showBranding: { type: Boolean, default: true }, // false needs featureFlags.allowRemoveWatermark
    pill: {
      expand: { type: String, enum: ['hover', 'click', 'always'], default: 'hover' },
      size: { type: String, enum: ['small', 'medium', 'large'], default: 'medium' },
      // video needs agent.avatarVideoUrl; orb/aurora/plasma/pulse/glow are animated CSS spheres
      icon: { type: String, enum: ['avatar', 'video', 'orb', 'aurora', 'plasma', 'pulse', 'glow'], default: 'avatar' },
      // Avatar pill position: % shift of the face inside the circle (editor arrows)
      faceX: { type: Number, min: -30, max: 30, default: 0 },
      faceY: { type: Number, min: -30, max: 30, default: 0 },
      faceZoom: { type: Number, min: 50, max: 200, default: 100 },
      // #rrggbb tint over the blurred picture behind a moved/zoomed-out face; '' = no tint
      faceBg: { type: String, default: '' },
      placeholder: { type: String, default: 'Enter your work email' },
      requireWorkEmail: { type: Boolean, default: false },
      emailOptional: { type: Boolean, default: false },
      showMic: { type: Boolean, default: true },
    },
    smartbar: {
      placeholder: { type: String, default: '' }, // '' = "Ask anything about <agent name>"
      icon: { type: String, enum: ['orb', 'aurora', 'plasma', 'pulse', 'glow', 'avatar'], default: 'orb' },
    },
    // Per-page overrides, first match wins. Pattern is a path glob: /pricing, /docs/*, *
    rules: [{
      _id: false,
      urlPattern: { type: String },
      teaserText: { type: String, default: '' },
      starterQuestions: [String],
      autoOpenAfterMs: { type: Number, default: 0 }, // 0 = never
      hidden: { type: Boolean, default: false }, // no launcher or auto-open on matching pages
    }],
    preview: {
      source: { type: String, enum: ['demo', 'custom', 'none'], default: 'demo' },
      demoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Story', default: null },
      imageUrl: { type: String, default: '' }, // source = custom, set by the upload endpoint only
      animateCursor: { type: Boolean, default: true },
    },
  },

  links: [{ type: String, ref: 'Link' }],
  deletedAt: { type: Date, default: null },
}, options)

// Same shape as the Story list query
AiDemoAgent.index({ workspaceId: 1, deletedAt: 1 })

export default AiDemoAgent
