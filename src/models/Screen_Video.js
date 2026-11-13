import mongoose from 'mongoose'
import ZoomSpanVideoSchema from './ZoomSpanVideo.js'

const options = {
  strict: true,
  timestamps: { createdAt: true, updatedAt: true },
  discriminatorKey: 'type'
}


const ScreenVideo = new mongoose.Schema({
    asset: {},
    playbackRate: { type: mongoose.Number, default: 1},
    startTime: {type: Number, default: 0},
    endTime: {type: Number, default: 0},
    cursorPositions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CursorPositions' }],
    recordedStartMs: { type: Number },
    recordedEndMs: { type: Number },
    zoomSpans: [
      ZoomSpanVideoSchema
    ],
}, options
)

export default  ScreenVideo
