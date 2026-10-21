import mongoose from 'mongoose'

const { ObjectId } = mongoose.Schema.Types

// "Make it yours" claim token handed out by GET /own-claims/eligibility. Only the SHA-256 is stored
const OwnClaimToken = new mongoose.Schema({
    token: { type: String, required: true, unique: true },
    sourceKind: { type: String, enum: ['story', 'agent', 'showcase'], required: true },
    sourceId: { type: ObjectId, required: true },
    expiresAt: { type: Date, default: null } // null = never expires
}, { strict: true, timestamps: { createdAt: true, updatedAt: false } })

OwnClaimToken.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export default OwnClaimToken
