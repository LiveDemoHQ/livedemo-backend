import StoryStatuses from '../constants/StoryStatuses.js'
import mongoose from 'mongoose'
const options = {
  strict: true,
  timestamps: { createdAt: true, updatedAt: true },
}


const Config = new mongoose.Schema({
    lastWarmDate: { type: Date},
    // FOUNDING50 campaign — mirrored from Stripe, used if Stripe is unreachable
    foundingPromoCode: { type: String, default: 'FOUNDING50' },
    foundingPromoRedeemed: { type: Number, default: 0 },
    foundingPromoMax: { type: Number, default: 5 },
    foundingPromoSyncedAt: { type: Date },
  }, options
)

export default  Config
