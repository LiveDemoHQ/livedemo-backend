import mongoose from 'mongoose'

const options = {
  strict: true,
  timestamps: { createdAt: true, updatedAt: true },
}

const Feedback = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace' },
    email: { type: String, default: '' },
    name: { type: String, default: '' },
    reason: { type: String, default: '', maxlength: 40 },
    message: { type: String, default: '', maxlength: 4000 },
    source: { type: String, default: 'chrome-extension' },
    extensionVersion: { type: String, default: '' },
  }, options
)

export default Feedback
