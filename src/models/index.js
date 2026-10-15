import ENV_VARS from '../envServer.js'
import mongoose from 'mongoose'
const uri = ENV_VARS.DB_URI
import ScreenTypes from '../constants/ScreenTypes.js'
import ScreenTransitionTypes from '../constants/ScreenTransitionTypes.js'

import ConfigSchema from './Config.js'
import UserSchema from './User.js'
import AuthTokenSchema from './AuthToken.js'
import AuthToken_UserSchema from './AuthToken_User.js'
import AuthToken_DirectInstallSchema from './AuthToken_UserDirectInstall.js'
import AuthToken_UserChangePassword from './AuthToken_UserChangePassword.js'

import WorkspaceSchema from './Workspace.js'
import WorkspaceMemberSchema from './WorkspaceMember.js'
import SubscriptionSchema from './Subscription.js'
import SubscriptionCustomerSchema from './SubscriptionCustomer.js'
import EmailSchema from './Email.js'
import CardSchema from './Card.js'
import ChargeSchema from './Charge.js'
import JobSchema from './Job.js'
// const EventSchema = require('./Event')
// const SagaEventSchema = require('./SagaEvent')
import TourSchema from './Tour.js'
import StepSchema from './Step.js'
import ScreenStepSchema from './ScreenStep.js'

// const ScreenNavigationSchema = require('./ScreenTransition')

import ScreenTransitionSchema from './ScreenTransition.js'
import ScreenScreenshotTransitionSchema from './ScreenScreenshotTransition.js'
import ScreenPageTransitionSchema from './ScreenPageTransition.js'

import PublishedLiveDemoSchema from './PublishedLiveDemo.js'
import LiveDemoSchema from './LiveDemo.js'
import RequestSchema from './Request.js'
import ScriptSchema from './Script.js'
// const SubscriberSchema = require('./Subscriber')
import ContentSchema from './Content.js'
import StorySchema from './Story.js'
import ScreenSchema from './Screen.js'
import Screen_PageSchema from './Screen_Page.js'
import Screen_ScreenshotSchema from './Screen_Screenshot.js'
import Screen_VideoSchema  from './Screen_Video.js'
import FormSchema from './Form.js'
import LeadSchema from './Lead.js'

import SessionSchema from './Session.js'
import SessionEventSchema from './SessionEvent.js'

import ZoomSpanVideoSchema from './ZoomSpanVideo.js'
import ZoomSpanScreenshotSchema from './ZoomSpanScreenshot.js'

import StepAudioSchema from './StepAudio.js'
import AudioSchema from './Audio.js'
import StoryContentSchema from './StoryContent.js'

import LinkSchema from './Link.js'
import StoryRevisionSchema from './StoryRevision.js'
import AutoRecordingSchema from './AutoRecording.js'
import AutoRecordingEventSchema from './AutoRecordingEvent.js'
import DemoSuggestionSchema from './DemoSuggestion.js'
import DemoActivityEventSchema from './DemoActivityEvent.js'
import HubspotTokenSchema from './HubspotToken.js'
import CursorPositionsSchema from './CursorPositions.js'
import TutorialSchema from './Tutorial.js'
import UrlDemoSchema from './UrlDemo.js'
import EmailVerificationCodeSchema from './EmailVerificationCode.js'
import LaunchLinkSchema from './LaunchLink.js'
import LaunchSubscriberSchema from './LaunchSubscriber.js'
import LaunchConfigSchema from './LaunchConfig.js'

import AiDemoAgentSchema from './AiDemoAgent.js'
import LemonSliceAvatarSchema from './LemonSliceAvatar.js'
import AgentKnowledgeSourceSchema from './AgentKnowledgeSource.js'
import AgentKnowledgeChunkSchema from './AgentKnowledgeChunk.js'
import AgentRevisionSchema from './AgentRevision.js'
import AgentSessionSchema from './AgentSession.js'
import AgentMessageSchema from './AgentMessage.js'
import AgentSessionEventSchema from './AgentSessionEvent.js'
import WorkspaceWebhookSchema from './WorkspaceWebhook.js'


// const ChannelSchema = require('./Channel')
// const InstantMessagesChannelSchema = require('./InstantMessagesChannel')
// const WorkspaceMemberSchema = require('./WorkspaceMember')
// const MessageSchema = require('./Message')
// const InstantMessageSchema = require('./InstantMessage')
// const FileMessageSchema = require('./File')
// const ExportSchema = require('./Export')
// const MessageAnalysisSchema = require('./MessageAnalysis')
// const IMMessageAnalysisSchema = require('./IMMessageAnalysis')
// const WorkspaceEncryptionKeySchema = require('./WorkspaceEncryptionKey')
// const CryptoMessageSchema = require('./CryptoMessage')
// const IMCryptoMessageSchema = require('./IMCryptoMessage')
// const IMCryptoWordSchema = require('./IMCryptoWord')
// const CryptoWordSchema = require('./CryptoWord')
// const ConversationSchema = require('./Conversation')
// const TopicSchema = require('./Topic')
// const GroupTopicSchema = require('./GroupTopic')
// const UserReportSchema = require('./UserReport')
// const WorkspaceReportSchema = require('./WorkspaceReport')
// const ChannelReportSchema = require('./ChannelReport')
// const MentionSchema = require('./Mention')
// const NodeSchema = require('./Node')
// const ConnectionSchema = require('./Connection')
// const GraphSchema = require('./Graph')
// const PairSchema = require('./Pair')
// const AppBotSchema = require('./AppBot')
// const ActivitySchema = require('./Activity')
// const GroupActivitySchema = require('./GroupActivity')

import mongoosePaginate from 'mongoose-paginate-v2'
import mongooseAggregatePaginate from 'mongoose-aggregate-paginate-v2'

/**
 * Returns 'conn' - Mongoose Connection Instance
 *
 * @returns {Connection}
 */
export const connect = async () => {
  // Because `conn` is in the global scope, Lambda may retain it between
  // function calls thanks to `callbackWaitsForEmptyEventLoop`.
  // This means your Lambda function doesn't have to go through the
  // potentially expensive process of connecting to MongoDB every time.
  mongoose.set('strictPopulate', false)

  const conn = mongoose.createConnection(uri, {
    // Buffering means mongoose will queue up operations if it gets
    // disconnected from MongoDB and send them when it reconnects.
    // With serverless, better to fail fast if not connected.
    // directConnection: true, //used for running adhoc scripts which skip replicaSet config discovery
    bufferCommands: false, // Disable mongoose buffering
    directConnection: true,
  })

  await conn.asPromise()
  return conn
}

export const setupDB = async () => {
  const connResolved = await connect()
  initModels(connResolved)
  return connResolved
}

/**
 * Expects conn to be an already open Mongo connection
 *
 * @param conn
 */
export const initModels = (conn) => {
// this will add paginate function.
  mongoosePaginate.paginate.options = {
    limit: 10,
    lean: true
  }

  // MessageSchema.plugin(mongoosePaginate)
  // InstantMessageSchema.plugin(mongoosePaginate)
  // FileMessageSchema.plugin(mongoosePaginate)
  // UserReportSchema.plugin(mongoosePaginate)
  //
  // CryptoWordSchema.plugin(mongooseAggregatePaginate)
  // IMCryptoWordSchema.plugin(mongooseAggregatePaginate)
  //
  // ConversationSchema.plugin(mongooseAggregatePaginate)

  conn.model('Config', ConfigSchema)
  conn.model('Card', CardSchema)
  conn.model('WorkspaceMember', WorkspaceMemberSchema)
  conn.model('User', UserSchema)

  // init a discriminator for AuthToken different types(functionalities)
  let authTokenModel = conn.model('AuthToken', AuthTokenSchema)
  authTokenModel.discriminator('AuthToken_User', AuthToken_UserSchema)
  authTokenModel.discriminator('AuthToken_UserDirectInstall', AuthToken_DirectInstallSchema)
  authTokenModel.discriminator('AuthToken_UserChangePassword', AuthToken_UserChangePassword)

  let screenModel = conn.model('Screen', ScreenSchema)
  screenModel.discriminator(ScreenTypes.SCREEN_PAGE, Screen_PageSchema)
  screenModel.discriminator(ScreenTypes.SCREEN_SCREENSHOT, Screen_ScreenshotSchema)
  screenModel.discriminator(ScreenTypes.SCREEN_VIDEO, Screen_VideoSchema)


  // conn.model('Event', EventSchema)
  // conn.model('SagaEvent', SagaEventSchema)
  // conn.model('Channel', ChannelSchema)
  // conn.model('InstantMessagesChannel', InstantMessagesChannelSchema)
  conn.model('Workspace', WorkspaceSchema)
  // conn.model('Message', MessageSchema)
  // conn.model('InstantMessage', InstantMessageSchema)
  // conn.model('File', FileMessageSchema)
  conn.model('Charge', ChargeSchema)
  conn.model('Subscription', SubscriptionSchema)
  conn.model('SubscriptionCustomer', SubscriptionCustomerSchema)
  conn.model('Job', JobSchema)
  conn.model('Email', EmailSchema)

  conn.model('Script', ScriptSchema)
  conn.model('Tour', TourSchema)
  conn.model('ScreenStep', ScreenStepSchema)

  // conn.model('ScreenTransition', ScreenTransitionSchema)

  let screenTransition = conn.model('ScreenTransition', ScreenTransitionSchema)
  screenTransition.discriminator(ScreenTransitionTypes.HOTSPOT, ScreenScreenshotTransitionSchema)
  screenTransition.discriminator(ScreenTransitionTypes.ECLICK, ScreenPageTransitionSchema)


  conn.model('Form', FormSchema)
  conn.model('Lead', LeadSchema)
  conn.model('Step', StepSchema)

  conn.model('PublishedLiveDemo', PublishedLiveDemoSchema)
  conn.model('LiveDemo', LiveDemoSchema)
  conn.model('Content', ContentSchema)
  conn.model('Request', RequestSchema)

  conn.model('Story', StorySchema)
  conn.model('Screen', ScreenSchema)

  conn.model('Session', SessionSchema)
  conn.model('SessionEvent', SessionEventSchema)

  conn.model('ZoomSpanVideo', ZoomSpanVideoSchema)
  conn.model('ZoomSpanScreenshot', ZoomSpanScreenshotSchema)

  conn.model('StepAudio', StepAudioSchema)

  conn.model('Audio', AudioSchema)
  conn.model('StoryContent', StoryContentSchema)

  conn.model('Link', LinkSchema)
  conn.model('StoryRevision', StoryRevisionSchema)

  conn.model('DemoSuggestion', DemoSuggestionSchema)
  conn.model('AutoRecording', AutoRecordingSchema)
  conn.model('AutoRecordingEvent', AutoRecordingEventSchema)
  conn.model('DemoActivityEvent', DemoActivityEventSchema)
  conn.model('HubspotToken', HubspotTokenSchema)
  conn.model('CursorPositions', CursorPositionsSchema)
  conn.model('Tutorial', TutorialSchema)
  conn.model('UrlDemo', UrlDemoSchema)
  conn.model('EmailVerificationCode', EmailVerificationCodeSchema)
  conn.model('LaunchLink', LaunchLinkSchema)
  conn.model('LaunchSubscriber', LaunchSubscriberSchema)
  conn.model('LaunchConfig', LaunchConfigSchema)

  conn.model('AiDemoAgent', AiDemoAgentSchema)
  conn.model('LemonSliceAvatar', LemonSliceAvatarSchema)
  conn.model('AgentKnowledgeSource', AgentKnowledgeSourceSchema)
  conn.model('AgentKnowledgeChunk', AgentKnowledgeChunkSchema)
  conn.model('AgentRevision', AgentRevisionSchema)
  conn.model('AgentSession', AgentSessionSchema)
  conn.model('AgentMessage', AgentMessageSchema)
  conn.model('AgentSessionEvent', AgentSessionEventSchema)
  conn.model('WorkspaceWebhook', WorkspaceWebhookSchema)

  // conn.model('Subscriber', SubscriberSchema)

  // conn.model('Export', ExportSchema)
  // conn.model('MessageAnalysis', MessageAnalysisSchema)
  // conn.model('IMMessageAnalysis', IMMessageAnalysisSchema)
  // conn.model('WorkspaceEncryptionKey', WorkspaceEncryptionKeySchema)
  // conn.model('CryptoMessage', CryptoMessageSchema)
  // conn.model('IMCryptoMessage', IMCryptoMessageSchema)
  // conn.model('CryptoWord', CryptoWordSchema)
  // conn.model('IMCryptoWord', IMCryptoWordSchema)
  // conn.model('Conversation', ConversationSchema)
  // conn.model('UserReport', UserReportSchema)
  // conn.model('WorkspaceReport', WorkspaceReportSchema)
  // conn.model('ChannelReport', ChannelReportSchema)
  // conn.model('Topic', TopicSchema)
  // conn.model('GroupTopic', GroupTopicSchema)
  // conn.model('Mention', MentionSchema)
  // conn.model('Node', NodeSchema)
  // conn.model('Connection', ConnectionSchema)
  // conn.model('Graph', GraphSchema)
  // conn.model('Pair', PairSchema)
  // conn.model('AppBot', AppBotSchema)
  // conn.model('Activity', ActivitySchema)
  // conn.model('GroupActivity', GroupActivitySchema)

}

export const getModels = (conn) => {
  return {
    AuthToken: conn.model('AuthToken'),
    AuthToken_User: conn.model('AuthToken_User'),
    AuthToken_UserChangePassword: conn.model('AuthToken_UserChangePassword'),
    Config: conn.model('Config'),
    Card: conn.model('Card'),
    User: conn.model('User'),
    Workspace: conn.model('Workspace'),
    WorkspaceMember: conn.model('WorkspaceMember'),
    Charge: conn.model('Charge'),
    Subscription: conn.model('Subscription'),
    SubscriptionCustomer: conn.model('SubscriptionCustomer'),
    Job: conn.model('Job'),
    Email: conn.model('Email'),
    PublishedLiveDemo: conn.model('PublishedLiveDemo'),
    LiveDemo: conn.model('LiveDemo'),
    Request: conn.model('Request'),
    Script: conn.model('Script'),
    Tour: conn.model('Tour'),
    Step: conn.model('Step'),
    ScreenStep: conn.model('ScreenStep'),
    // ScreenNavigation: conn.model('ScreenNavigation'),
    ScreenTransition: conn.model('ScreenTransition'),
    ScreenScreenshotTransition: conn.model(ScreenTransitionTypes.HOTSPOT),
    ScreenPageTransition: conn.model(ScreenTransitionTypes.ECLICK),
    Content: conn.model('Content'),
    Story: conn.model('Story'),
    Screen: conn.model('Screen'),
    Screen_Video: conn.model(ScreenTypes.SCREEN_VIDEO),
    Screen_Screenshot: conn.model(ScreenTypes.SCREEN_SCREENSHOT),
    Screen_Page: conn.model(ScreenTypes.SCREEN_PAGE),
    Form: conn.model('Form'),
    Lead: conn.model('Lead'),
    Session: conn.model('Session'),
    SessionEvent: conn.model('SessionEvent'),
    ZoomSpanVideo: conn.model('ZoomSpanVideo'),
    ZoomSpanScreenshot: conn.model('ZoomSpanScreenshot'),
    StepAudio: conn.model('StepAudio'),
    Audio: conn.model('Audio'),
    StoryContent: conn.model('StoryContent'),
    Link: conn.model('Link'),
    StoryRevision: conn.model('StoryRevision'),
    AutoRecording: conn.model('AutoRecording'),
    AutoRecordingEvent: conn.model('AutoRecordingEvent'),
    DemoSuggestion: conn.model('DemoSuggestion'),
    DemoActivityEvent: conn.model('DemoActivityEvent'),
    HubspotToken: conn.model('HubspotToken'),
    CursorPositions: conn.model('CursorPositions'),
    Tutorial: conn.model('Tutorial'),
    UrlDemo: conn.model('UrlDemo'),
    EmailVerificationCode: conn.model('EmailVerificationCode'),
    LaunchLink: conn.model('LaunchLink'),
    LaunchSubscriber: conn.model('LaunchSubscriber'),
    LaunchConfig: conn.model('LaunchConfig'),
    AiDemoAgent: conn.model('AiDemoAgent'),
    LemonSliceAvatar: conn.model('LemonSliceAvatar'),
    AgentKnowledgeSource: conn.model('AgentKnowledgeSource'),
    AgentKnowledgeChunk: conn.model('AgentKnowledgeChunk'),
    AgentRevision: conn.model('AgentRevision'),
    AgentSession: conn.model('AgentSession'),
    AgentMessage: conn.model('AgentMessage'),
    AgentSessionEvent: conn.model('AgentSessionEvent'),
    WorkspaceWebhook: conn.model('WorkspaceWebhook'),

    // Channel: conn.model('Channel'),
    // InstantMessagesChannel: conn.model('InstantMessagesChannel'),
    // Message: conn.model('Message'),
    // InstantMessage: conn.model('InstantMessage'),
    // File: conn.model('File'),
    // MessageAnalysis: conn.model('MessageAnalysis'),
    // IMMessageAnalysis: conn.model('IMMessageAnalysis'),
    // WorkspaceEncryptionKey: conn.model('WorkspaceEncryptionKey'),
    // CryptoMessage: conn.model('CryptoMessage'),
    // IMCryptoMessage: conn.model('IMCryptoMessage'),
    // CryptoWord: conn.model('CryptoWord'),
    // IMCryptoWord: conn.model('IMCryptoWord'),
    // Conversation: conn.model('Conversation'),
    // UserReport: conn.model('UserReport'),
    // WorkspaceReport: conn.model('WorkspaceReport'),
    // ChannelReport: conn.model('ChannelReport'),
    // Topic: conn.model('Topic'),
    // GroupTopic: conn.model('GroupTopic'),
    // Mention: conn.model('Mention'),
    // Node: conn.model('Node'),
    // Connection: conn.model('Connection'),
    // Graph: conn.model('Graph'),
    // Pair: conn.model('Pair'),
    // AppBot: conn.model('AppBot'),
    // Activity: conn.model('Activity'),
    // GroupActivity: conn.model('GroupActivity'),

  }
}

// Old implementation

// mongoose.connect(uri)
// // plug in the promise library:
// mongoose.Promise = global.Promise
//
//
// mongoose.connection.on('error', (err) => {
//   console.error(`Mongoose connection error: ${err}`)
//   process.exit(1)
// })

// load models
// require('./AuthToken')
// require('./transaction')
// require('./RunToken')
// require('./User')
// require('./UserSeller')
// require('./UserAdmin')
// require('./product')
// require('./Vm')
// require('./Event')
//
// require('./Run')
