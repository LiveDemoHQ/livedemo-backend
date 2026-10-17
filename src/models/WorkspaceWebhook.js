import mongoose from 'mongoose'

const options = {
    strict: true,
    timestamps: { createdAt: true, updatedAt: true }
}

// Outbound event subscriptions. Own collection (not on Workspace) so the
// workspace payload every member loads never carries signing secrets.
const WorkspaceWebhook = new mongoose.Schema({
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    // ga4 / segment: server-side analytics (GA4 Measurement Protocol, Segment HTTP Tracking API)
    kind: { type: String, enum: ['webhook', 'slack', 'ga4', 'segment'], default: 'webhook' },
    url: { type: String, required: true },
    // webhook: HMAC-SHA256 key. ga4 / segment: sealed api secret / write key (helpers/secretBox.js)
    secret: { type: String, default: '' },
    measurementId: { type: String, default: '' }, // ga4 only
    events: [{
        type: String,
        enum: ['lead.created', 'lead.qualified', 'session.ended', 'meeting.booked', 'recap.viewed', 'demo.viewed', 'demo.completed', 'demo.lead']
    }],
    enabled: { type: Boolean, default: true },
    lastStatus: { type: Number },
    lastError: { type: String, default: '' },
    lastDeliveredAt: { type: Date }
}, options)

export default WorkspaceWebhook
