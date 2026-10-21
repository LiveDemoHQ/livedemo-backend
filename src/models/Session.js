import StoryStatuses from '../constants/StoryStatuses.js'
import mongoose from 'mongoose'
const options = {
  strict: true,
  timestamps: { createdAt: true, updatedAt: true },
}


const Session = new mongoose.Schema({

    // sessionId: {
    //   type: String,
    //   index: true,
    //   unique: true
    // },
    // 'livedemo': a standalone demo visit (storyId set).
    // 'agent': rrweb recording of an AI agent visit — storyId null, agentSessionId set.
    // Missing type on old docs means 'livedemo'.
    type: { type: String, enum: ['livedemo', 'agent'], default: 'livedemo' },
    agentSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentSession', default: null },
    // Story play opened from a showcase (still type 'livedemo')
    showcaseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Showcase', default: null },
    showcaseSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShowcaseSession', default: null },
    // Story play inside a checklist journey
    checklistProgressId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChecklistProgress', default: null },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace' },
    storyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Story' },
    clientIpData: {},
    startTimestamp: { type: Number},
    endTimestamp: { type: Number},
    duration: { type: Number},
    eventsClickCount: {type: Number, default: 0},
    eventsCount: {type: Number, default: 0}, // agent recordings only, capped server-side
    stepsCount: {type: Number},
    dropOffStep: {type: Number},
    didPlay: {type: Boolean, default: false},
    didComplete: {type: Boolean, default: false},
  }, options
)

Session.index({ agentSessionId: 1 }, { partialFilterExpression: { agentSessionId: { $type: 'objectId' } } })
Session.index({ showcaseSessionId: 1 }, { partialFilterExpression: { showcaseSessionId: { $type: 'objectId' } } })

export default  Session
