import mongoose from 'mongoose'

const options = {
    strict: true,
    timestamps: { createdAt: true, updatedAt: true }
}

// One player load of a showcase (one per tab, resumed from sessionStorage)
const ShowcaseSession = new mongoose.Schema({
    showcaseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Showcase', index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', index: true },
    delivery: { type: String, enum: ['link', 'embed'], default: 'link' },
    hostOrigin: { type: String, default: '' }, // embed only, from allowedOrigin()
    referrer: { type: String, default: '' },
    utm: { type: mongoose.Schema.Types.Mixed, default: {} },
    clientIpData: {},
    startTimestamp: Number,
    lastSeenTimestamp: Number,
    // Ordered journey. Capped at 200 entries server-side.
    path: [{
        _id: false,
        itemId: String,
        kind: String,
        storyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Story' },
        via: { type: String, enum: ['grid', 'playlist', 'autoplay', 'deeplink', 'search'] },
        openedAt: Number,
        completedAt: Number,
        childSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' } // story play
    }],
    filtersUsed: [{ _id: false, facetId: String, optionId: String, at: Number }],
    itemsOpened: { type: Number, default: 0 },
    itemsCompleted: { type: Number, default: 0 },
    didComplete: { type: Boolean, default: false } // playlist: all visible items completed
}, options)

export default ShowcaseSession
