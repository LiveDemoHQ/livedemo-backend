import mongoose from 'mongoose'

const { ObjectId } = mongoose.Schema.Types

// A clickable region on a sandbox screen (Screen_Page.sandboxLinks). StoryDemo
// customTransitions are a separate field and never hold these.
const SandboxLinkSchema = new mongoose.Schema({
    gotoType: { type: String, enum: ['screen', 'flow', 'website'], required: true },
    gotoScreen: { type: ObjectId, ref: 'Screen', default: null }, // flow links: the flow start when created
    gotoFlowId: { type: ObjectId, default: null },
    gotoWebsite: { type: String, default: '' },
    anchor: {
        rrwebNodeId: { type: Number, default: null }, // same rrweb chain only
        selector: { type: String, default: '' },
        matchText: { type: String, default: '' },
        rect: { x: Number, y: Number, width: Number, height: Number } // % of the screen, 0-100
    },
    syncGroupId: { type: String, default: null },
    isPrimary: { type: Boolean, default: true },
    source: { type: String, enum: ['capture', 'manual', 'sync'], default: 'manual' },
    presenterNote: { type: String, default: '' }
}, { timestamps: true })

export default SandboxLinkSchema
