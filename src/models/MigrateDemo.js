import mongoose from 'mongoose'

const { ObjectId } = mongoose.Schema.Types

// One person asking for a cloned demo (landing form, web-app, or ai-api POST /clone-demo)
const MigrateDemoRequest = new mongoose.Schema({
    // Landing: where the "demo ready" email goes. App (source: app): omitted — claimUserId is stamped at POST.
    // Never returned by GET /migratedemos/:id
    email: { type: String },
    source: { type: String, default: 'landing' }, // landing | app | api
    userId: { type: ObjectId, ref: 'User' },
    browserSessionId: { type: String },
    emailSentAt: { type: Date },
    // Landing: set when this browser session registers / logs in. App: set on POST.
    claimUserId: { type: ObjectId, ref: 'User' },
    claimWorkspaceId: { type: ObjectId, ref: 'Workspace' },
    // Set once the copy is enqueued; never enqueued twice
    ownClaimId: { type: ObjectId, ref: 'OwnClaim' }
}, { _id: true, timestamps: { createdAt: true, updatedAt: false } })

// A public Storylane / Arcade / Navattic / Supademo demo cloned into the clone workspace by livedemo-ai-api's
// processMigrateDemo job. One per link (urlKey = normalizeDemoUrl(url)); mirrored in livedemo-ai-api/db/index.js
const MigrateDemo = new mongoose.Schema({
    url: { type: String, required: true },
    urlKey: { type: String, required: true },
    provider: { type: String }, // storylane | arcade | navattic | supademo
    status: { type: String, default: 'queued' }, // queued | processing | completed | failed
    // Short, user-safe message when failed
    error: { type: String },
    workspaceId: { type: ObjectId, ref: 'Workspace' },
    storyId: { type: ObjectId, ref: 'Story' },
    taskStoryIds: [{ type: ObjectId, ref: 'Story' }],
    // Editor links in the clone workspace: `${SERVER_URL}/workspace/${workspaceId}/storydemo/${storyId}`
    storyUrl: { type: String },
    taskStoryUrls: [String],
    // Stories replaced by a forced re-clone
    previousStoryIds: [{ type: ObjectId, ref: 'Story' }],
    warnings: [String],
    requests: [MigrateDemoRequest]
}, { strict: true, timestamps: true })

MigrateDemo.index({ urlKey: 1 }, { unique: true })
MigrateDemo.index({ 'requests.email': 1, 'requests.createdAt': -1 })
MigrateDemo.index({ 'requests.userId': 1, 'requests.createdAt': -1 })
MigrateDemo.index({ 'requests.browserSessionId': 1 })
MigrateDemo.index({ 'requests.claimUserId': 1, 'requests.ownClaimId': 1 })

export default MigrateDemo
