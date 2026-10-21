import StoryStatuses from '../constants/StoryStatuses.js'
import mongoose from 'mongoose'
import StoryTypes from "../constants/StoryTypes.js";
import SandboxSchema from './Sandbox.js'
import ChecklistSchema from './StoryChecklist.js'
import { OwnableSchema, ClonedFromSchema } from './Ownable.js'

const options = {
    strict: true,
    timestamps: {createdAt: true, updatedAt: true},
}


const Story = new mongoose.Schema({

        name: {type: String},
        // shortId: { type: String,
        //   index: true,
        //   unique: true
        // },
        workspaceId: {type: mongoose.Schema.Types.ObjectId, ref: 'Workspace'},
        userId: {type: mongoose.Schema.Types.ObjectId, ref: 'User'},
        screens: {
            type: [{type: mongoose.Schema.Types.ObjectId, ref: 'Screen'}],
            default: []
        },
        filePath: {type: String, default: ''},
        status: {type: String, default: StoryStatuses.UPLOADING},
        demoSuggestionId: { type: mongoose.Schema.Types.ObjectId, ref: 'DemoSuggestion' },
    
        isPublished: {type: Boolean, default: false},
        type: {type: String, default: StoryTypes.web}, // web, desktop
        capturedEvents: [],
        tabInfo: {},
        windowMeasures: {},
        videoStartMs: {type: mongoose.Schema.Types.Number},
        videoEndMs: {type: mongoose.Schema.Types.Number},
        aspectRatio: {type: mongoose.Schema.Types.String},
        hasCursorPositions: {type: Boolean},
        content: {
            contentStatus: {type: String, default: ''}, //updating, ready
            contentId: {type: mongoose.Schema.Types.ObjectId, ref: 'StoryContent'}
        },
        custom: {
            theme: {
                isActive: {type: Boolean, default: false},
                stepBackgroundColor: {type: String, default: '#1070ff'}, // backgroundColor
                backgroundColor: {type: String, default: '#FFFFFF'}, // backgroundColor
                textColor: {type: String, default: '#FFFFFF'}, // textColor
                buttonBackgroundColor: {type: String, default: '#1070ff'},// buttonColor
                buttonTextColor: {type: String, default: '#FFFFFF'}, // buttonColor
                fontFamily: {type: String, default: ''}, // google font name, empty = default font
                fontSize: {type: Number, default: 15}, // base text px, other demo text scales from it
                showTooltipArrow: {type: Boolean, default: true},
                hoverGlow: {type: Boolean, default: true},
                pulsatingBorderColor: {type: String, default: '#1070ff'}, // pointer pulsating border
                footerButtons: {type: String, default: 'backAndNext'}, // backAndNext | nextArrow
                watermarkConfig: {
                    imageUrl: {type: String, default: ''},
                    text: {type: String, default: ''},
                    url: {type: String, default: ''},
                    isActive: {type: Boolean, default: false},
                }
            },
            misc: {
                isActive: {type: Boolean, default: false},
                confettiOnLastStep: {type: Boolean, default: false},
                isOmniBarDisabled: {type: Boolean, default: false},
                isLiveDemoWatermarkEnabled: {type: Boolean, default: true},
                isTabsEnabled: {type: Boolean, default: true},
                customCursor: {type: Boolean, default: false}, // oversized arrow, hand over clickables
            },
            checklist: { type: ChecklistSchema, default: () => ({}) },
            background: {
                isActive: {type: Boolean, default: false},
                backgroundColor: {type: String, default: '#FFFFFF'},
                backgroundBlur: {type: Number, default: 0},
                backgroundType: {type: String, default: 'color'}, // wallpaper | gradient | color
                wallpaperImage: {type: String, default: ''},
                padding: {type: Number, default: 24},
            },
            backgroundMusic: {
                isActive: {type: Boolean, default: false},
                backgroundMusicUrl: {type: String, default: ''},
                backgroundMusicVolume: {type: Number, default: 50},
            },
            variables: [
                {
                    name: String,
                    value: String
                }
            ],
            security: {
                additionalContentSecurityPolicy: {type: String, default: ''},

            }
        },

        thumbnailImageUrl: {type: String, default: ''},

        recordingType: { type: String, enum: ['video_screenshot', 'html_delta'], default: 'video_screenshot' },
        rrweb: {
            version:  { type: String },
            href:     { type: String },
            viewport: {
                width:  { type: Number },
                height: { type: Number },
            },
        },

        // Absent = guided StoryDemo. No defaults, so guided documents and payloads stay unchanged
        mode: { type: String, enum: ['guided', 'sandbox'] },
        sandbox: { type: SandboxSchema, default: undefined },
        // "Add flow to…" recordings: the temporary story that carries the upload
        sandboxCapture: {
            type: new mongoose.Schema({
                targetSandboxId: { type: mongoose.Schema.Types.ObjectId, ref: 'Story', default: null },
                flowName: { type: String, default: '' }
            }, { _id: false }),
            default: undefined
        },

        tags: { type: [String], default: [] },
        ownable: { type: OwnableSchema, default: undefined },
        clonedFrom: { type: ClonedFromSchema, default: undefined },
        links: [
            {type: String, ref: 'Link'}
        ],
        deletedAt: {type: Date, default: null}
    }, options
)

export default Story
