import mongoose from 'mongoose'

const { ObjectId } = mongoose.Schema.Types

// Item _ids are stable: progress records and analytics reference them
const ChecklistItemSchema = new mongoose.Schema({
    title: { type: String, default: '' }, // '' = task story name
    description: { type: String, default: '' },
    estimatedMinutes: { type: Number, default: 0 },
    clickAction: {
        type: { type: String, enum: ['startDemo', 'openStep', 'url', 'converted'], default: 'startDemo' },
        storyId: { type: ObjectId, ref: 'Story', default: null }, // startDemo / openStep; may be the host itself
        stepId: { type: ObjectId, default: null }, // openStep: a step of storyId
        url: { type: String, default: '' },
        openInNewTab: { type: Boolean, default: true }
    },
    // demoComplete: task demo fired livedemo_demo_complete. click: clicking the item completes it (url / converted)
    completion: { type: String, enum: ['demoComplete', 'click', 'none'], default: 'demoComplete' }
})

// The button that opens and closes the checklist
const ChecklistLauncherSchema = new mongoose.Schema({
    isVisible: { type: Boolean, default: true }, // false = opened only by step actions / embed SDK
    text: { type: String, default: 'Get started' },
    icon: { type: String, enum: ['checklist', 'rocket', 'sparkles', 'play', 'none', 'custom'], default: 'checklist' },
    iconUrl: { type: String, default: '' }, // icon: 'custom'
    iconPosition: { type: String, enum: ['left', 'right'], default: 'left' },
    showProgressBadge: { type: Boolean, default: true },
    hideTextWhenOpen: { type: Boolean, default: true },

    backgroundColor: { type: String, default: null }, // null = host custom.theme.buttonBackgroundColor
    textColor: { type: String, default: null }, // null = host custom.theme.buttonTextColor
    borderColor: { type: String, default: null },
    shape: { type: String, enum: ['pill', 'rounded', 'square', 'circle'], default: 'pill' }, // circle = icon only
    size: { type: String, enum: ['sm', 'md', 'lg'], default: 'md' },
    shadow: { type: Boolean, default: true },
    pulse: { type: String, enum: ['none', 'untilOpened', 'always'], default: 'untilOpened' },

    corner: { type: String, enum: ['bottomRight', 'bottomLeft', 'topRight', 'topLeft'], default: 'bottomLeft' },
    offsetX: { type: Number, default: 16 }, // px from the corner, 0-200
    offsetY: { type: Number, default: 16 }
}, { _id: false })

const ChecklistSchema = new mongoose.Schema({
    isActive: { type: Boolean, default: false },
    layout: { type: String, enum: ['sidebar', 'floating'], default: 'floating' },
    position: { type: String, enum: ['left', 'right'], default: 'right' }, // panel side

    title: { type: String, default: 'Get started' },
    description: { type: String, default: '' },
    logoUrl: { type: String, default: '' },

    showLogo: { type: Boolean, default: false },
    showProgressBar: { type: Boolean, default: true },
    showEstimatedTime: { type: Boolean, default: false },
    showRemainingCount: { type: Boolean, default: false },

    launchOn: { type: String, enum: ['manual', 'demoStart', 'itemComplete'], default: 'manual' },
    startHidden: { type: Boolean, default: false },
    resetOnLoad: { type: Boolean, default: false },
    confettiOnComplete: { type: Boolean, default: false },

    launcher: { type: ChecklistLauncherSchema, default: () => ({}) },

    items: { type: [ChecklistItemSchema], default: [] },
    ctaButtons: [{
        _id: false,
        text: { type: String, default: 'Book a demo' },
        url: { type: String, default: '' },
        textColor: { type: String, default: null },
        backgroundColor: { type: String, default: null }
    }],

    theme: {
        checkmarkColor: { type: String, default: null }, // null = host custom.theme.stepBackgroundColor
        panelBackgroundColor: { type: String, default: null },
        panelTextColor: { type: String, default: null }
    },

    // Bumped when the set of item _ids or any item's storyId changes. Progress records on an older version are reset.
    version: { type: Number, default: 1 }
}, { _id: false })

export default ChecklistSchema
