import mongoose from 'mongoose'

const options = {
  strict: true,
  timestamps: { createdAt: true, updatedAt: true },
  discriminatorKey: 'type'
}

import ScreenStepSchema from './ScreenStep.js'
import ScreenTransitionSchema from './ScreenTransition.js'
import ScreenPageTransitionSchema from './ScreenPageTransition.js'
import SandboxLinkSchema from './SandboxLink.js'

const ScreenPage = new mongoose.Schema({

    contentPath: { type: String },
    width: { type: mongoose.Number},
    height: { type: mongoose.Number},

    // rrweb DOM-demo screens (absent on legacy static HTML screens)
    recordingRole: { type: String, enum: ['base', 'delta'] },
    baseScreenId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Screen' },
    snapshotPath:  { type: String },
    eventsPath:    { type: String },
    eventCount:    { type: Number },
    fromTimeMs:    { type: Number },
    toTimeMs:      { type: Number },

    // Sandbox screens only. No defaults: StoryDemo screens never get these keys
    sandboxLinks:       { type: [SandboxLinkSchema], default: undefined },
    sandboxDuplicateOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Screen' },
    sandboxHidden:      { type: Boolean },

  }, options
)

export default  ScreenPage
