import mongoose from 'mongoose'

const { ObjectId } = mongoose.Schema.Types

// One viewer's journey through one host checklist (see STORYDEMO_CHECKLIST_TECH_DESIGN.md §3.7)
const ChecklistProgress = new mongoose.Schema({
    // 32 hex chars from crypto.randomBytes(16). Travels in ?cl= and localStorage. Never an ObjectId (guessable).
    token: { type: String, required: true, unique: true },
    hostStoryId: { type: ObjectId, ref: 'Story', index: true },
    workspaceId: { type: ObjectId, ref: 'Workspace', index: true },
    checklistVersion: { type: Number, default: 1 },

    completedItemIds: [{ type: ObjectId }],
    convertedItemIds: [{ type: ObjectId }],
    state: { type: String, enum: ['hidden', 'closed', 'open'], default: 'closed' },
    firstOpenedAt: { type: Number, default: null },
    completedAt: { type: Number, default: null }, // all items done
    convertedAt: { type: Number, default: null }, // first 'converted' item or CTA click

    // Ordered journey, capped at 200 entries server-side
    path: [{
        _id: false,
        itemId: ObjectId,
        storyId: { type: ObjectId, ref: 'Story' },
        openedAt: Number,
        completedAt: Number,
        sessionId: { type: ObjectId, ref: 'Session' }
    }],

    delivery: { type: String, enum: ['link', 'embed'], default: 'link' },
    referrer: { type: String, default: '' },
    utm: { type: mongoose.Schema.Types.Mixed, default: {} },
    clientIpData: {},
    startTimestamp: Number,
    lastSeenTimestamp: Number
}, { strict: true, timestamps: { createdAt: true, updatedAt: true } })

ChecklistProgress.index({ hostStoryId: 1, startTimestamp: -1 })
// Retention: 365 days without activity
ChecklistProgress.index({ updatedAt: 1 }, { expireAfterSeconds: 365 * 24 * 3600 })

export default ChecklistProgress
