import mongoose from 'mongoose'

const options = {
  strict: true,
  timestamps: { createdAt: true, updatedAt: true },
  discriminatorKey: 'type'
}

// Personal API keys (ld_live_…, no expiry) and OAuth access tokens (ld_oat_…, oauthClientId set) for the MCP server.
// `token` holds sha256(key); the plain key is shown once. See helpers/authHelpers.js and handlers/apiKeys.js.
const AuthToken_ApiKeySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  name: { type: String, default: '' },
  prefix: { type: String, default: '' },
  lastUsedAt: { type: Date },
  expiresAt: { type: Date },
  oauthClientId: { type: String },
  refreshTokenHash: { type: String, index: { unique: true, sparse: true } }
}, options)

export default AuthToken_ApiKeySchema
