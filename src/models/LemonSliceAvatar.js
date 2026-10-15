import mongoose from 'mongoose'

const options = {
  strict: true,
  timestamps: { createdAt: true, updatedAt: true },
}

// Workspace-owned LemonSlice face made from an uploaded photo. Any agent in the
// workspace can pick it (AiDemoAgent.lemonsliceAvatarId = this _id as string).
const LemonSliceAvatar = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  name: { type: String, default: '' },
  imageUrl: { type: String, required: true }, // what LemonSlice animates (agent_image_url)
  sourceImageUrl: { type: String, default: '' }, // the original upload on our S3
  // false: LemonSlice avatar-variants was unavailable, so sessions reframe it (edit_image)
  reframed: { type: Boolean, default: false },
  // Idle clip for the embed pill, recorded once after upload (recordLemonSliceClip job). '' until then.
  videoUrl: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, options)

export default LemonSliceAvatar
