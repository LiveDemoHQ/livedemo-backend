import mongoose from 'mongoose'

const { ObjectId } = mongoose.Schema.Types

// "Make it yours" settings. Written only by handlers/putOwnable.js; never carried over to a copy
export const OwnableSchema = new mongoose.Schema({
    enabled: { type: Boolean, default: false },
    ctaLabel: { type: String, default: '' }, // '' = "Make it yours"
    includeKnowledge: { type: Boolean, default: false }, // AiDemoAgent only
    claimTokenTtlHours: { type: Number, default: 2 }, // How long a preview page's "Make it yours" link stays valid; 0 = never expires
    enabledBy: { type: ObjectId, ref: 'User', default: null },
    enabledAt: { type: Date, default: null }
}, { _id: false })

// Provenance of a claimed copy. Informational only: nothing syncs from the source
export const ClonedFromSchema = new mongoose.Schema({
    kind: { type: String, enum: ['story', 'agent', 'showcase'] },
    id: { type: ObjectId },
    claimId: { type: ObjectId, ref: 'OwnClaim' }
}, { _id: false })
