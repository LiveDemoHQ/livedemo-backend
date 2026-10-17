import WorkspaceTypes from '../constants/WorkspaceTypes.js'
import mongoose from 'mongoose'
import mongooseLongFunction from 'mongoose-long'
mongooseLongFunction(mongoose)

const options = {
  strict: false,
  timestamps: { createdAt: true, updatedAt: true },
  typeKey: '$type'
}

const WorkspaceSchema = new mongoose.Schema({
    name: { $type: String, default: '' },
    type: { $type: String, default: WorkspaceTypes.EMPTY }, // startup | pro | business
    integrations: {
      hubspot: { $type: Boolean, default: false },
    },
    // Sender for visitor emails, see helpers/agent/emailSending.js. Holds the encrypted SMTP password
    summaryEmailSending: { $type: mongoose.Schema.Types.Mixed, select: false },
    // Growth plan: own Anam / LemonSlice keys, encrypted { enc, updatedAt, updatedBy }. See helpers/agent/providerKeys.js
    providerKeys: { $type: mongoose.Schema.Types.Mixed, select: false },
    // SAML SSO (Growth), see handlers/sso.js. idpCert is public; nothing here is secret
    sso: {
      enabled: { $type: Boolean, default: false },
      enforced: { $type: Boolean, default: false },
      domains: { $type: [String], default: undefined }, // verified only, lowercase
      pendingDomain: { name: String, token: String },
      idpEntityId: { $type: String, default: '' },
      idpSsoUrl: { $type: String, default: '' },
      idpCert: { $type: String, default: '' },
      lastLoginAt: Date // first successful SSO login unlocks enforcement
    },
    // Custom domain for public demo / agent links (Growth), see handlers/customDomain.js
    customDomain: {
      hostname: String, // lowercase, e.g. demos.acme.com
      status: String, // pending | active
      cfHostnameId: String,
      lastError: String
    },
    adminUser: { $type: mongoose.Schema.ObjectId, ref: 'User'},
    users: [
      { $type: mongoose.Schema.ObjectId, ref: 'User' }
    ],
    subscriptions: [
      { $type: mongoose.Schema.ObjectId, ref: 'Subscription' }
    ],
    liveDemos: [{
      $type: mongoose.Schema.Types.ObjectId, ref: 'LiveDemo', default: []
    }],
    invitedEmails: [
      {$type: String, default: []}
    ],
    // Visits from these IPs get no analytics Session / recording. Empty = off. See helpers/isAnalyticsExcludedIp.js
    analyticsExcludedIps: [
      { $type: String }
    ],
    tags: [{
      name: { $type: String, default: '' }
    }],
    library: {
      pages: [
        { $type: mongoose.Schema.Types.ObjectId, ref: 'Screen' },
      ],
      screenshots: [
        { $type: mongoose.Schema.Types.ObjectId, ref: 'Screen' },
      ],
      videos: [
        { $type: mongoose.Schema.Types.ObjectId, ref: 'Screen' },
      ]
    }
  }, options
)

// A domain / hostname belongs to one workspace only
WorkspaceSchema.index({ 'sso.domains': 1 }, { unique: true, partialFilterExpression: { 'sso.domains': { $type: 'string' } } })
WorkspaceSchema.index({ 'customDomain.hostname': 1 }, { unique: true, partialFilterExpression: { 'customDomain.hostname': { $type: 'string' } } })

export default  WorkspaceSchema
