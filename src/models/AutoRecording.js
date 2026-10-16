import mongoose from 'mongoose'
import AutoRecordingTypes from "../constants/AutoRecordingTypes.js";
import AutoRecordingStatuses from "../constants/AutoRecordingStatuses.js";
const options = {
  strict: true,
  timestamps: { createdAt: true, updatedAt: true },
}


const AutoRecording = new mongoose.Schema({

    // sessionId: {
    //   type: String,
    //   index: true,
    //   unique: true
    // },
    status: { type: String, default: AutoRecordingStatuses.recording}, //
    type: { type: String, default: AutoRecordingTypes.exploring}, //
    aiName: { type: String, default: ''},
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace' },
    windowMeasures: {},
    demoSuggestions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'DemoSuggestion' }],
    thumbnailImageData: { type: String, default: '' },
    tags: { type: [String], default: [] },
    sessionData: {
        clientIpData: {},
        startTimestamp: { type: Number},
        endTimestamp: { type: Number},
        duration: { type: Number},
        eventsClickCount: {type: Number, default: 0}
    },

  }, options
)

export default AutoRecording
