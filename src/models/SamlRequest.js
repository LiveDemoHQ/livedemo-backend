import mongoose from 'mongoose'

const options = {
    strict: true,
    timestamps: { createdAt: true, updatedAt: false }
}

// node-saml InResponseTo cache, shared by all API pods (an in-memory cache breaks with 2+ pods). 10 minute TTL.
const SamlRequestSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now, index: { expires: 600 } }
}, options)

export default SamlRequestSchema
