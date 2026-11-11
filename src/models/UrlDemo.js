import mongoose from 'mongoose'

const UrlDemo = new mongoose.Schema(
    {
        url: { type: String, required: true },
        browserSessionId: { type: String },
        type: { type: String, default: 'standard' }, // enum: ['standard', 'browsed', 'owned']
        storyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Story' },
        demoType: { type: String, enum: ['storydemo', 'agent'], default: 'storydemo' },
        agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiDemoAgent' },
        status: { type: String, default: 'processing' }, // processing | completed | failed
        error: { type: String },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    },
    {
        strict: true,
        timestamps: { createdAt: true, updatedAt: true },
    }
)

UrlDemo.index({ url: 1 })
UrlDemo.index({ url: 1, status: 1 })

export default UrlDemo
