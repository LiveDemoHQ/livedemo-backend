import mongoose from 'mongoose'

const options = {
    strict: true,
    timestamps: { createdAt: true, updatedAt: true }
}

// One row per live avatar stream (Anam or LemonSlice). Seconds are summed per
// workspace and calendar month; a `slot` is held only while the session is the
// workspace's concurrent face on LiveDemo's keys.
const AvatarUsageSchema = new mongoose.Schema({
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiDemoAgent', required: true },
    provider: { type: String, enum: ['anam', 'lemonslice'], required: true },
    ownKey: { type: Boolean, default: false },
    period: { type: String, required: true },
    // sessionAvatarTime × 60 at start. Heartbeats use this, not a fresh subscription lookup.
    limitSeconds: { type: Number, default: 0 },
    // 0 .. concurrentSessionAvatars-1 while running. $unset frees the slot.
    slot: { type: Number },
    room: { type: String, default: '' },
    controlUrl: { type: String, default: '', select: false },
    startedAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    endedAt: { type: Date },
    seconds: { type: Number, default: 0 },
    endReason: { type: String, default: '' }
}, options)

AvatarUsageSchema.index({ workspaceId: 1, period: 1, ownKey: 1 })
AvatarUsageSchema.index({ endedAt: 1, lastSeenAt: 1 })
// Numbered slots: two starts can't take the same slot. Own-key rows have no slot.
AvatarUsageSchema.index(
    { workspaceId: 1, slot: 1 },
    { unique: true, partialFilterExpression: { slot: { $exists: true } } }
)

export default AvatarUsageSchema
