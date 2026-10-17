import mongoose from 'mongoose'

const options = {
    strict: true,
    timestamps: { createdAt: true, updatedAt: true }
}

// OAuth 2.1 public clients (PKCE, no secret) registered via dynamic client registration (RFC 7591),
// e.g. Claude.ai / ChatGPT connecting to the MCP server. See handlers/oauth.js.
const OAuthClientSchema = new mongoose.Schema({
    clientId: { type: String, required: true, unique: true },
    clientName: { type: String, default: '' },
    redirectUris: [{ type: String }]
}, options)

export default OAuthClientSchema
