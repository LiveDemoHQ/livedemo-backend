import mongoose from 'mongoose'

const options = {
    strict: true,
    timestamps: { createdAt: true, updatedAt: false }
}

// Single-use authorization codes (stored hashed), 10 minute TTL. See handlers/oauth.js.
const OAuthCodeSchema = new mongoose.Schema({
    codeHash: { type: String, required: true, unique: true },
    clientId: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    redirectUri: { type: String, required: true },
    codeChallenge: { type: String, required: true },
    resource: { type: String, default: '' },
    expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, options)

export default OAuthCodeSchema
