import mongoose from 'mongoose'

const { ObjectId } = mongoose.Schema.Types

// One "Make it yours" click. pending = anonymous, waiting for signup/login (claimOwnRequestsForUser);
// cloning = queued for processors/processOwnClaim.js
const OwnClaim = new mongoose.Schema({
    sourceKind: { type: String, enum: ['story', 'agent', 'showcase'], required: true },
    sourceId: { type: ObjectId, required: true },
    // Author side, for the Templates analytics tab
    sourceWorkspaceId: { type: ObjectId, ref: 'Workspace', required: true },
    browserSessionId: { type: String, default: '' },
    userId: { type: ObjectId, ref: 'User', default: null },
    workspaceId: { type: ObjectId, ref: 'Workspace', default: null },
    status: { type: String, enum: ['pending', 'cloning', 'completed', 'failed'], default: 'pending' },
    clonedId: { type: ObjectId, default: null },
    error: { type: String, default: '' },
    completedAt: { type: Date, default: null }
}, { strict: true, timestamps: { createdAt: true, updatedAt: true } })

// ponytail: unclaimed rows are kept (no TTL) so analytics can show abandoned clicks; add a TTL on
// { status: 'pending' } if the collection ever grows enough to matter
OwnClaim.index({ browserSessionId: 1, userId: 1, status: 1 })
OwnClaim.index({ userId: 1, sourceKind: 1, sourceId: 1 })
OwnClaim.index({ sourceWorkspaceId: 1, createdAt: -1 })

export default OwnClaim
