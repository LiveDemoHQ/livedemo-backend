import mongoose from 'mongoose'

const options = {
    strict: true,
    timestamps: { createdAt: true, updatedAt: true }
}

// Outbound event subscriptions. Own collection (not on Workspace) so the
// workspace payload every member loads never carries signing secrets.
const WorkspaceWebhook = new mongoose.Schema({
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    kind: { type: String, enum: ['webhook', 'slack'], default: 'webhook' },
    url: { type: String, required: true },
    secret: { type: String, default: '' }, // HMAC-SHA256 key, webhook kind only
    events: [{ type: String, enum: ['lead.created', 'lead.qualified', 'session.ended', 'meeting.booked', 'recap.viewed'] }],
    enabled: { type: Boolean, default: true },
    lastStatus: { type: Number },
    lastError: { type: String, default: '' },
    lastDeliveredAt: { type: Date }
}, options)

export default WorkspaceWebhook
