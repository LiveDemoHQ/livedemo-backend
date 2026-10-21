import mongoose from 'mongoose'
import short from 'short-uuid'
import { OwnableSchema, ClonedFromSchema } from './Ownable.js'

const options = {
    strict: true,
    timestamps: { createdAt: true, updatedAt: true }
}

// A published, shareable collection of demos / agents / resources. References only, never copies.
// Access is workspace membership (validateUserHasAccessToWorkspace), not userId.
// All writes go through helpers/showcase/normalizeShowcase.js.
const Showcase = new mongoose.Schema({
    name: { type: String, default: 'Untitled showcase' },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // creator only
    isPublished: { type: Boolean, default: false },

    layout: { type: String, enum: ['gallery', 'playlist'], default: 'gallery' },

    header: {
        title: { type: String, default: '' }, // '' = name
        subtitle: { type: String, default: '' },
        logoUrl: { type: String, default: '' }
    },
    theme: {
        mode: { type: String, enum: ['light', 'dark'], default: 'light' },
        accentColor: { type: String, default: '#1070ff' },
        backgroundColor: { type: String, default: '' }, // '' = mode default
        cardStyle: { type: String, enum: ['thumbnail', 'compact'], default: 'thumbnail' }
    },
    seo: {
        title: { type: String, default: '' },
        description: { type: String, default: '' },
        noindex: { type: Boolean, default: true }
    },

    // Gallery: grid sections. Playlist: chapters in the rail.
    sections: [{
        _id: { type: String, default: () => short.generate() },
        title: { type: String, default: '' },
        description: { type: String, default: '' }
    }],

    // Gallery filter facets, e.g. Persona: [Developer, PM]
    facets: [{
        _id: { type: String, default: () => short.generate() },
        name: { type: String },
        options: [{ _id: { type: String, default: () => short.generate() }, name: String }]
    }],

    items: [{
        _id: { type: String, default: () => short.generate() },
        kind: { type: String, enum: ['demo', 'agent', 'video', 'link'], required: true },
        sectionId: { type: String, default: null },
        storyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Story' }, // kind demo
        agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiDemoAgent' }, // kind agent
        url: { type: String, default: '' }, // video / link
        title: { type: String, default: '' }, // '' = story / agent name
        description: { type: String, default: '' },
        thumbnailUrl: { type: String, default: '' }, // '' = story thumbnail / provider thumbnail
        ctaLabel: { type: String, default: '' }, // '' = "View demo"
        facetOptionIds: { type: [String], default: [] },
        estimatedMinutes: { type: Number, default: 0 },
        hidden: { type: Boolean, default: false }, // kept in editor, skipped in player
        flowId: { type: String, default: null }, // kind demo + sandbox story: play this flow
        restrictToFlow: { type: Boolean, default: true } // block links leaving the flow
    }],

    gallery: {
        showSearch: { type: Boolean, default: true },
        showFilters: { type: Boolean, default: true },
        columns: { type: Number, min: 1, max: 4, default: 3 }
    },
    playlist: {
        autoplayNext: { type: Boolean, default: true }, // on livedemo_demo_complete
        showProgress: { type: Boolean, default: true },
        checklist: { type: Boolean, default: true }
    },

    cta: {
        label: { type: String, default: '' }, // '' = no header CTA
        url: { type: String, default: '' }
    },

    // Same semantics as AiDemoAgent.embed. Embedding needs isPublished && embed.enabled.
    embed: {
        enabled: { type: Boolean, default: false },
        allowedDomains: { type: [String], default: [] }, // [] = any site; feeds frame-ancestors
        showBranding: { type: Boolean, default: true } // false needs featureFlags.allowRemoveWatermark
    },

    tags: { type: [String], default: [] },
    ownable: { type: OwnableSchema, default: undefined },
    clonedFrom: { type: ClonedFromSchema, default: undefined },
    deletedAt: { type: Date, default: null }
}, options)

Showcase.index({ workspaceId: 1, deletedAt: 1 })
Showcase.index({ workspaceId: 1, 'items.storyId': 1 })

export default Showcase
