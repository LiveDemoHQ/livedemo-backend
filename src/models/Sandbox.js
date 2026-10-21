import mongoose from 'mongoose'

const { ObjectId } = mongoose.Schema.Types

// Story.sandbox, only on stories with mode: 'sandbox'. Flow _ids are stable:
// Showcase items and flow links reference them.
const FlowSchema = new mongoose.Schema({
    name: { type: String, default: '' },
    description: { type: String, default: '' },
    startScreenId: { type: ObjectId, ref: 'Screen', default: null },
    screenIds: [{ type: ObjectId, ref: 'Screen' }],
    completion: {
        type: { type: String, enum: ['none', 'screen', 'visitAll'], default: 'none' },
        screenIds: [{ type: ObjectId, ref: 'Screen' }]
    },
    estimatedMinutes: { type: Number, default: 0 },
    recordingFilePath: { type: String, default: '' }
})

const SandboxSchema = new mongoose.Schema({
    startScreenId: { type: ObjectId, ref: 'Screen', default: null },
    flows: { type: [FlowSchema], default: [] },
    allowEmbed: { type: Boolean, default: true },
    showFlowMenu: { type: Boolean, default: false },
    revealLinkHints: { type: Boolean, default: false },
    hintOnMisclick: { type: Boolean, default: true },
    resetScroll: { type: Boolean, default: true },
    keyboardNavigation: { type: Boolean, default: true },
    showLinkSuggestions: { type: Boolean, default: true }
}, { _id: false })

export default SandboxSchema
