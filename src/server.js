import {default as ENV} from './envServer.js'
import jsdom from 'jsdom'
import express from 'express'
import bodyParser from 'body-parser'
import monq from 'monq'

import path from 'path'

import postScreensHandler from './handlers/postScreens.js'
import postStoryDomRecordingEventsHandler from './handlers/postStoryDomRecordingEvents.js'
import postStoryDomRecordingFinishHandler from './handlers/postStoryDomRecordingFinish.js'
import postStoriesHandler from './handlers/postStories.js'
import postDesktopStoriesHandler from './handlers/postDesktopStories.js'
import postEmptyStoryHandler from './handlers/postEmptyStory.js'
import postInProgressStoryHandler from './handlers/postInProgressStory.js'
import patchStoryHandler from './handlers/patchStory.js'
import postTransitionsHandler from './handlers/postTransitions.js'
import deleteTransitionHandler from './handlers/deleteTransition.js'
import patchTransitionHandler from './handlers/patchTransition.js'
import getStoriesHandler from './handlers/getStories.js'
import { getWorkspaceTags, postWorkspaceTag, deleteWorkspaceTag, postWorkspaceTagAssign } from './handlers/workspaceTags.js'
import getStoryByIdHandler from './handlers/getStoryById.js'
import postCustomThemeUploadWatermarkImageHandler from './handlers/postCustomThemeUploadWatermarkImage.js'
import postCustomThemeHandler from './handlers/postCustomTheme.js'
import postCustomMiscHandler from './handlers/postCustomMisc.js'
import postCustomSecurityHandler from './handlers/postCustomSecurity.js'
import postCustomBackgroundHandler from './handlers/postCustomBackground.js'
import postCustomBackgroundMusicHandler from './handlers/postCustomBackgroundMusic.js'
import postCustomBackgroundMusicUploadHandler from './handlers/postCustomBackgroundMusicUpload.js'
import postCustomVariablesHandler from './handlers/postCustomVariables.js'
import patchCustomVariablesHandler from './handlers/patchCustomVariables.js'
import deleteCustomVariablesHandler from './handlers/deleteCustomVariables.js'
import postScreenEditTextHandler from './handlers/postScreenEditText.js'
import patchScreenHandler from './handlers/patchScreen.js'
import postStoryUpdateScreenOrderHandler from './handlers/postStoryUpdateScreenOrder.js'
import postStoryUpdateStepOrderHandler from './handlers/postStoryUpdateStepOrder.js'
import postScreenCopyHandler from './handlers/postScreenCopy.js'
import postScreenBaseMergeHandler from './handlers/postScreenBaseMerge.js'
import postCreateScreenFromFrameHandler from './handlers/postCreateScreenFromFrame.js'
import getScreenPreviewHandler from './handlers/getScreenPreview.js'
import getStoryPreviewHandler from './handlers/getStoryPreview.js'
import postStepsHandler from './handlers/postSteps.js'
import deleteScreenHandler from './handlers/deleteScreen.js'
import deleteStepHandler from './handlers/deleteStep.js'
import deleteStoryHandler from './handlers/deleteStory.js'
import postStoryCloneHandler from './handlers/postStoryClone.js'
import postStoryImportHandler from './handlers/postStoryImport.js'
import patchStepHandler from './handlers/patchStep.js'
import postFormsHandler from './handlers/postForms.js'
import patchFormHandler from './handlers/patchForm.js'
import postFormFieldsHandler from './handlers/postFormFields.js'
import patchFormFieldsHandler from './handlers/patchFormFields.js'
import deleteFormFieldsHandler from './handlers/deleteFormFields.js'
import postLeadsFormHandler from './handlers/postLeadsForm.js'
import getWorkspaceLibraryHandler from './handlers/getWorkspaceLibrary.js'
import postScreenUploadHandler from './handlers/postScreenUpload.js'
import getPreviewStoryHandler from './handlers/getPreviewStory.js'
import getLiveDemoOEmbedHandler from './handlers/getLiveDemoOEmbed.js'
import postStoryPublishHandler from './handlers/postStoryPublish.js'
import getLiveDemoPreviewHandler from './handlers/getLiveDemoPreview.js'
import postStorySessionEventsHandler from './handlers/postStorySessionEvents.js'
import postStorySessionHandler from './handlers/postStorySession.js'
import getStorySessionEventsHandler from './handlers/getStorySessionEvents.js'
import getWorkspaceSessionsHandler from './handlers/getWorkspaceSessions.js'
import getWorkspaceLeadsHandler from './handlers/getWorkspaceLeads.js'
import patchScreenPopupsHandler from './handlers/patchScreenPopups.js'

import getStorySessionsHandler from './handlers/getStorySessions.js'
import postWorkspaceLibraryUploadScreenshotHandler from './handlers/postWorkspaceLibraryUploadScreenshot.js'
import postWorkspaceLibraryUploadVideoHandler from './handlers/postWorkspaceLibraryUploadVideo.js'
import postWorkspaceLibraryUploadPageHandler from './handlers/postWorkspaceLibraryUploadPage.js'
// import postStoryAddScreenHandler from './handlers/postStoryAddScreen.js'
import postStepZoomSpansHandler from './handlers/postStepZoomSpans.js'
import patchStepZoomSpanHandler from './handlers/patchStepZoomSpan.js'
import postZoomSpansHandler from './handlers/postZoomSpans.js'
import patchZoomSpanHandler from './handlers/patchZoomSpan.js'
import deleteStepZoomSpanHandler from './handlers/deleteStepZoomSpan.js'
import deleteZoomSpanHandler from './handlers/deleteZoomSpan.js'

import postStoryAITextHandler from './handlers/postStoryAIText.js'
import postStoryAIVoiceHandler from './handlers/postStoryAIVoice.js'
import postGenerateAIVoiceHandler from './handlers/postGenerateAIVoice.js'

import deleteStepAudioHandler from './handlers/deleteStepAudio.js'
import postStepAudioHandler from './handlers/postStepAudio.js'

import postStepUploadAudioHandler from './handlers/postStepUploadAudio.js'
import postStepPreviewImageHandler from './handlers/postStepPreviewImage.js'

import postGenerateStoryContentHandler from './handlers/postGenerateStoryContent.js'

import getWorkspaceVoicesHandler from './handlers/getWorkspaceVoices.js'
import getWorkspacesHandler from './handlers/getWorkspaces.js'
import getWorkspaceByIdHandler from './handlers/getWorkspaceById.js'
import postWorkspaceAddUserHandler from './handlers/postWorkspaceAddUser.js'
import patchWorkspaceHandler from './handlers/patchWorkspace.js'
import patchWorkspaceIntegrationsHandler from './handlers/patchWorkspaceIntegrations.js'
import getWorkspaceHubspotFormsHandler from './handlers/getWorkspaceHubspotForms.js'
import postCreateWorkspaceHandler from './handlers/postCreateWorkspace.js'
import getSubscriptionsHandler from './handlers/getSubscriptions.js'
import patchSubscriptionHandler from './handlers/patchSubscription.js'
import getSubscriptionCustomerHandler from './handlers/getSubscriptionCustomer.js'
import patchSubscriptionCustomerHandler from './handlers/patchSubscriptionCustomer.js'
import getUsersHandler from './handlers/getUsers.js'
import patchUsersHandler from './handlers/patchUsers.js'
import postUsersHandler from './handlers/postUsers.js'
import postPasswordAuthenticateHandler from './handlers/postPasswordAuthenticate.js'
import postTokenAuthenticateHandler from './handlers/postTokenAuthenticate.js'
import postRefreshTokenHandler from './handlers/postRefreshToken.js'
import getUsersCardsHandler from './handlers/getUsersCards.js'
import postForgotPasswordHandler from './handlers/postForgotPassword.js'
import postSendChangePasswordEmailHandler from './handlers/postSendChangePasswordEmail.js'
import postChangePasswordHandler from './handlers/postChangePassword.js'
import getUsersAuthGoogleLinkHandler from './handlers/getUsersAuthGoogleLink.js'
import postUsersAuthGoogleLinkHandler from './handlers/postUsersAuthGoogleLink.js'
import getUsersAuthGoogleCallbackHandler from './handlers/getUsersAuthGoogleCallback.js'
import postUsersAuthGoogleOneTapHandler from './handlers/postUsersAuthGoogleOneTap.js'
import postUsersSendEmailVerifyHandler from './handlers/postUsersSendEmailVerify.js'
import postUsersCheckEmailVerifyHandler from './handlers/postUsersCheckEmailVerify.js'
import postUsersUnsubscribeHandler from './handlers/postUsersUnsubscribe.js'
import postLaunchLinksHandler from './handlers/postLaunchLinks.js'
import patchLaunchLinksHandler from './handlers/patchLaunchLinks.js'
import postLaunchSubscribeHandler from './handlers/postLaunchSubscribe.js'
import postFeedbackHandler from './handlers/postFeedback.js'
import postUninstallFeedbackHandler from './handlers/postUninstallFeedback.js'
import getLaunchConfigHandler from './handlers/getLaunchConfig.js'
import getIntegrationsHubspotCallbackHandler from './handlers/getIntegrationsHubspotCallback.js'
import postLogoutHandler from './handlers/postLogout.js'
import postCloseAccountHandler from './handlers/postCloseAccount.js'
import deleteWorkspaceHandler from './handlers/deleteWorkspace.js'
import getCardsHandler from './handlers/getCards.js'
import deleteCardHandler from './handlers/deleteCard.js'
import getChargesHandler from './handlers/getCharges.js'
import postWorkspaceRemoveUserHandler from './handlers/postWorkspaceRemoveUser.js'
import postPaymentChargeHandler from './handlers/postPaymentCharge.js'
import postCheckoutSessionHandler from './handlers/postCheckoutSession.js'
import postVerifyCheckoutSessionHandler from './handlers/postVerifyCheckoutSession.js'
import postBillingPortalHandler from './handlers/postBillingPortal.js'
import postPaymentsWebhookHandler from './handlers/postPaymentsWebhook.js'
import postWebhooksSequenzyHandler from './handlers/postWebhooksSequenzy.js'
import postPaymentFreeActivateHandler from './handlers/postPaymentFreeActivate.js'
import postPaymentAfterPaymentHandler from './handlers/postPaymentAfterPayment.js'
import postVerifyPaymentChargeHandler from './handlers/postVerifyPaymentCharge.js'
import postPaymentChargeInternalHandler from './handlers/postPaymentChargeInternal.js'
import postJobFinalizeSubscriptionHandler from './handlers/postJobFinalizeSubscription.js'
import postJobCancelSubscriptionHandler from './handlers/postJobCancelSubscription.js'
import postJobExpireSubscriptionsHandler from './handlers/postJobExpireSubscriptions.js'

import postStoryLinksHandler from './handlers/postStoryLinks.js'

import patchStoryLinkHandler from './handlers/patchStoryLink.js'

import deleteStoryLinkHandler from './handlers/deleteStoryLink.js'

import getStoryLinksHandler from './handlers/getStoryLinks.js'

import postAutoRecordingsHandler from './handlers/postAutoRecordings.js'

import postAutoRecordingsEventsHandler from './handlers/postAutoRecordingsEvents.js'

import postAutoRecordingsCompleteHandler from './handlers/postAutoRecordingsComplete.js'

import getAutoRecordingByIdHandler from './handlers/getAutoRecordingById.js'
import getAutoRecordingsHandler from './handlers/getAutoRecordings.js'

import postDemoSuggestionsGenerateLiveDemoHandler from './handlers/postDemoSuggestionsGenerateLiveDemo.js'

import postAuthorizeInstanceHandler from './handlers/postAuthorizeInstance.js'
import postInstanceAuthenticateHandler from './handlers/postInstanceAuthenticate.js'
import getTutorialsSearchHandler from './handlers/getTutorialsSearch.js'
import postUrlDemosHandler from './handlers/postUrlDemos.js'
import getUrlDemosHandler from './handlers/getUrlDemos.js'

import postStoryUndoHandler from './handlers/postStoryUndo.js'
import postStoryRedoHandler from './handlers/postStoryRedo.js'
import getStoryHistoryHandler from './handlers/getStoryHistory.js'
import postStoryRevertHandler from './handlers/postStoryRevert.js'
import captureStoryRevision from './middlewares/captureStoryRevision.js'

// AI Demo Agents
import postAgentHandler from './handlers/postAgent.js'
import getAgentsHandler from './handlers/getAgents.js'
import getAgentByIdHandler from './handlers/getAgentById.js'
import patchAgentHandler from './handlers/patchAgent.js'
import postAgentEmbedPreviewImageHandler, { PREVIEW_TYPES } from './handlers/postAgentEmbedPreviewImage.js'
import deleteAgentHandler from './handlers/deleteAgent.js'
import postAgentPublishHandler from './handlers/postAgentPublish.js'
import postAgentKnowledgeHandler from './handlers/postAgentKnowledge.js'
import getAgentKnowledgeHandler from './handlers/getAgentKnowledge.js'
import patchAgentKnowledgeHandler from './handlers/patchAgentKnowledge.js'
import deleteAgentKnowledgeHandler from './handlers/deleteAgentKnowledge.js'
import postAgentKnowledgeReindexHandler from './handlers/postAgentKnowledgeReindex.js'
import postAgentUndoHandler from './handlers/postAgentUndo.js'
import postAgentRedoHandler from './handlers/postAgentRedo.js'
import getAgentHistoryHandler from './handlers/getAgentHistory.js'
import postAgentRevertHandler from './handlers/postAgentRevert.js'
import postAgentSessionHandler from './handlers/postAgentSession.js'
import postAgentChatHandler from './handlers/postAgentChat.js'
import postAgentTtsHandler from './handlers/postAgentTts.js'
import getAnamAvatarsHandler from './handlers/getAnamAvatars.js'
import getAnamVoicesHandler from './handlers/getAnamVoices.js'
import postAnamSessionHandler from './handlers/postAnamSession.js'
import postAvatarUsageHeartbeatHandler from './handlers/postAvatarUsageHeartbeat.js'
import postAvatarUsageEndHandler from './handlers/postAvatarUsageEnd.js'
import getWorkspaceAvatarUsageHandler from './handlers/getWorkspaceAvatarUsage.js'
import getLemonSliceAvatarsHandler from './handlers/getLemonSliceAvatars.js'
import postLemonSliceAvatarHandler, { IMAGE_TYPES as AVATAR_IMAGE_TYPES } from './handlers/postLemonSliceAvatar.js'
import deleteLemonSliceAvatarHandler from './handlers/deleteLemonSliceAvatar.js'
import postLemonSliceAvatarClipHandler from './handlers/postLemonSliceAvatarClip.js'
import postLemonSliceSessionHandler from './handlers/postLemonSliceSession.js'
import postAgentTranscribeHandler from './handlers/postAgentTranscribe.js'
import postAgentAckHandler from './handlers/postAgentAck.js'
import getAgentPreviewHandler from './handlers/getAgentPreview.js'
import getAgentPlayerHandler from './handlers/getAgentPlayer.js'
import getWorkspaceAgentSessionsHandler from './handlers/getWorkspaceAgentSessions.js'
import getAgentSessionsHandler from './handlers/getAgentSessions.js'
import getAgentSessionByIdHandler from './handlers/getAgentSessionById.js'
import getAgentSessionRecordingHandler from './handlers/getAgentSessionRecording.js'
import postAgentRecordingEventsHandler from './handlers/postAgentRecordingEvents.js'
import agentKnowledgeInsights from './handlers/agentKnowledgeInsights.js'
import workspaceWebhooks from './handlers/workspaceWebhooks.js'
import agentEmails from './handlers/agentEmails.js'
import providerKeys from './handlers/providerKeys.js'
import apiKeys from './handlers/apiKeys.js'
import oauth from './handlers/oauth.js'
import sessionOnly from './middlewares/sessionOnly.js'
import sso from './handlers/sso.js'
import customDomainHandlers from './handlers/customDomain.js'
import customDomain from './middlewares/customDomain.js'
import agentRecap from './handlers/agentRecap.js'
import captureAgentRevision from './middlewares/captureAgentRevision.js'
import agentEditorMode, { agentEditorModeOptional } from './middlewares/agentEditorMode.js'
import showcases from './handlers/showcases.js'
import ownClaims from './handlers/ownClaims.js'
import migrateDemos from './handlers/migrateDemos.js'
import checklists from './handlers/checklists.js'
import getShowcasePlayerHandler from './handlers/getShowcasePlayer.js'
import sandbox from './handlers/sandbox.js'

import multer from 'multer'


import * as fs from 'fs'
// import fsp from 'fs/promises.js'
import {getModels, setupDB} from './models/index.js'
import ensureAgentVectorIndex from './helpers/agent/ensureAgentVectorIndex.js'
import startAgentSchedulers from './helpers/agent/schedulers.js'

import ResponseCodes from './constants/ResponseCodes.js'
import * as https from 'https'
import * as http from 'http'
import axios from "axios";


// import axios from 'axios'
const privateAuthToken = ENV.PRIVATE_AUTH_TOKEN

const SCREENDOC_ENCODING = 'utf-8'

const options = {
    key: fs.readFileSync('./certs/key.pem'),
    cert: fs.readFileSync('./certs/cert.pem')
}

async function setupWorkers() {
    const client = monq(process.env.DB_URI || 'mongodb://localhost:27017/livedemo_app')

    const conn = await setupDB()
    const Models = getModels(conn)

    const sharedConfig = {
        Models,
        axios
    }
    const processors = await import('./processors/index.js')
    const processorsConfig = processors.default(sharedConfig)


    const worker = client.worker(processorsConfig.allQueueNames, processorsConfig.workerConfig)
    const videoWorker = client.worker(processorsConfig.videoQueueNames, processorsConfig.videoWorkerConfig)
    // An 'error' event without a listener crashes the process; monq reconnects on its own
    worker.on('error', err => console.log('[monq] worker error', err.message))
    videoWorker.on('error', err => console.log('[monq] video worker error', err.message))
    worker.start()
    videoWorker.start()
    startAgentSchedulers(Models)

    console.log('Story consumer started')
    console.log('Video consumer started')

}


const app = express()

let conn = null
let Models = null

function setupMongo(req, res, next) {
    req.mongo = { conn, Models }
    next()
}

// Story version-history capture: records a pre-image of what the route touches
// onto the story's undo stack when the handler responds 2xx (see the middleware)
const rev = captureStoryRevision

// Stripe webhook must receive the raw body before JSON body parsers run
app.post('/payments/webhook', [setupMongo, express.raw({ type: 'application/json' })], postPaymentsWebhookHandler)
app.post('/webhooks/sequenzy', [setupMongo, express.raw({ type: 'application/json' })], postWebhooksSequenzyHandler)

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json({limit: '5000mb', extended: true}))
// Customer domains only reach their own public demo / agent pages (rewritten here); everything else 404s
app.use(setupMongo, customDomain)
// Our API/preview hosts stay out of search; embedded previews still count for the page that embeds them
app.use((req, res, next) => {
    if (!req.customDomainWorkspaceId) res.set('X-Robots-Tag', 'noindex, indexifembedded')
    next()
})
app.options('*', (req, res) => {
    const resultResponse = {
        statusCode: ResponseCodes['200_OK'],
        headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept,X-Requested-With', // Required for CORS support to work
            // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
        }
    }

    res.set(resultResponse.headers)
    res.status(resultResponse.statusCode)
    res.send()
})

// Handle health check
app.get('/', (req, res) => {
    const resultResponse = {
        statusCode: ResponseCodes['200_OK'],
        headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
            // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
        }
    }

    res.set(resultResponse.headers)
    res.status(resultResponse.statusCode)
    res.send()
})

// Liveness: must not touch the DB, or a Mongo blip would restart every pod
app.get('/healthz', (req, res) => res.status(200).send('ok'))
// Readiness: bufferCommands is off, so with Mongo disconnected every request would fail
app.get('/readyz', (req, res) => {
    const ready = conn?.readyState === 1
    res.status(ready ? 200 : 503).send(ready ? 'ready' : 'db not connected')
})

function corsMiddleware(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
}

app.post('/stories', [setupMongo, corsMiddleware], postStoriesHandler)
app.post('/desktopStories', [setupMongo, corsMiddleware], postDesktopStoriesHandler)
app.post('/emptyStory', [setupMongo, corsMiddleware], postEmptyStoryHandler)
app.post('/inProgressStory', [setupMongo, corsMiddleware], postInProgressStoryHandler)
app.patch('/workspaces/:workspaceId/stories/:storyId', [setupMongo, rev('story', 'story:update')], patchStoryHandler)
app.get('/livedemos/:storyId', [setupMongo], getLiveDemoPreviewHandler)

app.delete('/workspaces/:workspaceId/stories/:storyId', [setupMongo], deleteStoryHandler)
app.post('/workspaces/:workspaceId/stories/:storyId/clone', [setupMongo], postStoryCloneHandler)
app.post('/workspaces/:workspaceId/stories/import', [setupMongo], postStoryImportHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/screens', [setupMongo, rev('story', 'screen:add')], postScreensHandler)
app.post('/workspaces/:workspaceId/stories/:storyId/domRecording/events', [setupMongo], postStoryDomRecordingEventsHandler)
app.post('/workspaces/:workspaceId/stories/:storyId/domRecording/finish', [setupMongo], postStoryDomRecordingFinishHandler)


app.post('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/transitions', [setupMongo, rev('screen', 'transition:add')], postTransitionsHandler)


app.delete('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/transitions/:transitionId', [setupMongo, rev('screen', 'transition:delete')], deleteTransitionHandler)


app.patch('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/transitions/:transitionId', [setupMongo, rev('screen', 'transition:update')], patchTransitionHandler)


app.get('/workspaces', [setupMongo], getWorkspacesHandler)

app.post('/workspaces', [setupMongo], postCreateWorkspaceHandler)

app.get('/workspaces/:workspaceId', [setupMongo], getWorkspaceByIdHandler)

app.patch('/workspaces/:workspaceId', [setupMongo], patchWorkspaceHandler)

app.patch('/workspaces/:workspaceId/integrations', [setupMongo], patchWorkspaceIntegrationsHandler)

app.get('/workspaces/:workspaceId/hubspot/forms', [setupMongo], getWorkspaceHubspotFormsHandler)

app.delete('/workspaces/:workspaceId', [setupMongo, sessionOnly], deleteWorkspaceHandler)

app.post('/workspaces/:workspaceId/addUser', [setupMongo], postWorkspaceAddUserHandler)

app.post('/workspaces/:workspaceId/removeUser', [setupMongo], postWorkspaceRemoveUserHandler)

app.get('/workspaces/:workspaceId/stories', [setupMongo], getStoriesHandler)
app.get('/workspaces/:workspaceId/tags', [setupMongo], getWorkspaceTags)
app.post('/workspaces/:workspaceId/tags', [setupMongo], postWorkspaceTag)
app.delete('/workspaces/:workspaceId/tags/:tagId', [setupMongo], deleteWorkspaceTag)
app.post('/workspaces/:workspaceId/tags/assign', [setupMongo], postWorkspaceTagAssign)

app.get('/workspaces/:workspaceId/library', [setupMongo], getWorkspaceLibraryHandler)

app.get('/subscriptions', [setupMongo], getSubscriptionsHandler)

app.patch('/subscriptions/:subscriptionId', [setupMongo], patchSubscriptionHandler)

app.get('/subscription-customer', [setupMongo], getSubscriptionCustomerHandler)

app.patch('/subscription-customer', [setupMongo], patchSubscriptionCustomerHandler)

app.get('/users', [setupMongo], getUsersHandler)

app.post('/users', [setupMongo], postUsersHandler)

app.patch('/users', [setupMongo, sessionOnly], patchUsersHandler)

app.post('/users/password-authenticate', [setupMongo], postPasswordAuthenticateHandler)

app.post('/users/token-authenticate', [setupMongo, sessionOnly], postTokenAuthenticateHandler)

app.post('/users/refreshToken', [setupMongo, sessionOnly], postRefreshTokenHandler)

app.get('/users/cards', [setupMongo], getUsersCardsHandler)

app.post('/users/forgotPassword', [setupMongo], postForgotPasswordHandler)

app.post('/users/sendChangePasswordEmail', [setupMongo], postSendChangePasswordEmailHandler)

app.post('/users/changePassword', [setupMongo, sessionOnly], postChangePasswordHandler)

app.get('/users/auth/google-link', getUsersAuthGoogleLinkHandler)

app.post('/users/auth/google-link', postUsersAuthGoogleLinkHandler)

app.get('/users/auth/google-callback', [setupMongo], getUsersAuthGoogleCallbackHandler)

app.post('/users/auth/google-one-tap', [setupMongo], postUsersAuthGoogleOneTapHandler)

app.post('/users/send-email-verify', [setupMongo], postUsersSendEmailVerifyHandler)

app.post('/users/check-email-verify', [setupMongo], postUsersCheckEmailVerifyHandler)

app.post('/users/unsubscribe', [setupMongo], postUsersUnsubscribeHandler)

app.post('/launch/links', [setupMongo], postLaunchLinksHandler)
app.patch('/launch/links/:linkId', [setupMongo], patchLaunchLinksHandler)
app.post('/launch/subscribe', [setupMongo], postLaunchSubscribeHandler)
app.post('/feedback', [setupMongo], postFeedbackHandler)
app.post('/feedback/uninstall', [setupMongo], postUninstallFeedbackHandler)
app.get('/launch/:id', [setupMongo], getLaunchConfigHandler)

app.get('/integrations/hubspot-callback', [setupMongo], getIntegrationsHubspotCallbackHandler)

app.post('/users/logout', [setupMongo], postLogoutHandler)

app.post('/users/closeAccount', [setupMongo, sessionOnly], postCloseAccountHandler)

app.get('/cards', [setupMongo], getCardsHandler)

app.delete('/cards/:cardId', [setupMongo], deleteCardHandler)

app.get('/charges', [setupMongo], getChargesHandler)

app.post('/users/billing-portal', [setupMongo], postBillingPortalHandler)

app.post('/payments/charge', [setupMongo], postPaymentChargeHandler)

app.post('/payments/checkout-session', [setupMongo], postCheckoutSessionHandler)

app.post('/payments/verify-checkout-session', [setupMongo], postVerifyCheckoutSessionHandler)

app.post('/payments/freeActivate', [setupMongo], postPaymentFreeActivateHandler)

app.post('/payments/afterPayment', [setupMongo], postPaymentAfterPaymentHandler)

app.post('/verifyPaymentCharge', [setupMongo], postVerifyPaymentChargeHandler)

app.post('/payments/chargeInternal', [setupMongo], postPaymentChargeInternalHandler)

app.post('/jobs/finalizeSubscription', [setupMongo], postJobFinalizeSubscriptionHandler)

app.post('/jobs/cancelSubscription', [setupMongo], postJobCancelSubscriptionHandler)

app.post('/jobs/expireSubscriptions', [setupMongo], postJobExpireSubscriptionsHandler)


app.get('/workspaces/:workspaceId/stories/:storyId', [setupMongo], getStoryByIdHandler)

app.get('/workspaces/:workspaceId/stories/:storyId/sessions', [setupMongo], getStorySessionsHandler)

app.get('/workspaces/:workspaceId/sessions', [setupMongo], getWorkspaceSessionsHandler)

app.get('/workspaces/:workspaceId/leads', [setupMongo], getWorkspaceLeadsHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/aiText', [setupMongo], postStoryAITextHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/aiVoice', [setupMongo], postStoryAIVoiceHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/generateAiVoice', [setupMongo], postGenerateAIVoiceHandler)

app.delete('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/steps/:stepId/audios/:audioId', [setupMongo, rev('screen', 'audio:delete')], deleteStepAudioHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/steps/:stepId/audios', [setupMongo, rev('screen', 'audio:add')], postStepAudioHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/generateStoryContent', [setupMongo], postGenerateStoryContentHandler)

app.get('/workspaces/:workspaceId/voices', [setupMongo], getWorkspaceVoicesHandler)

app.post('/authorize-instance', [setupMongo], postAuthorizeInstanceHandler)

app.post('/instance-authenticate', [setupMongo], postInstanceAuthenticateHandler)


// app.get('/gif', [], getGifTestHandler)
//
// function getGifTestHandler(req, res){
//
//   return Promise.resolve()
//       .then(() => {
//
//         const resultResponse = {
//           statusCode: ResponseCodes['200_OK'],
//           headers: {
//             'cross-origin-resource-policy': 'cross-origin',
//             "Content-Type": "image/gif",
//             'Access-Control-Max-Age': 600,
//             'Access-Control-Allow-Origin': '*',
//             'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
//             // Required for CORS support to work
//             'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
//           },
//           body: JSON.stringify({})
//         }
//
//         fs.readFile("/home/exploitx/WebstormProjects/livedemo/tmp/tmp/framesloop.gif", function(err, data){
//         // fs.readFile("/home/exploitx/WebstormProjects/livedemo/tmp/tmp/65790176447bb90a38e47304test4.gif", function(err, data){
//         // fs.readFile("/home/exploitx/WebstormProjects/livedemo/tmp/tmp/65790176447bb90a38e47304test3.gif", function(err, data){
//
//
//
//           res.set(resultResponse.headers)
//           res.status(resultResponse.statusCode)
//           res.send(data)
//         })
//
//
//       })
//       .catch((error) => {
//         console.log(error)
//
//         let resultResponse
//         if (error.resultResponse) {
//
//           resultResponse = error.resultResponse
//         } else {
//
//
//           resultResponse = {
//             statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
//             headers: {
//               'Access-Control-Max-Age': 600,
//               'Access-Control-Allow-Origin': '*',
//               'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
//               // Required for CORS support to work
//               'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
//             },
//             body: ''
//           }
//
//         }
//
//         res.set(resultResponse.headers)
//         res.status(resultResponse.statusCode)
//         res.send(resultResponse.body)
//       })
//
// }


const uploadImage = multer({
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1,
    },
    fileFilter: function (req, file, callback) {
        var ext = path.extname(file.originalname)
        if (ext !== '.png' && ext !== '.jpg' && ext !== '.gif' && ext !== '.jpeg' && ext !== '.svg') {
            return callback(new Error('Only images are allowed'))
        }
        callback(null, true)
    },
})

const uploadAudio = multer({
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1,
    },
    fileFilter: function (req, file, callback) {
        const allowed = ['audio/mpeg', 'audio/wav', 'audio/wave', 'audio/x-wav']
        if (!allowed.includes(file.mimetype)) {
            return callback(new Error('Only mp3 and wav audio files are allowed'))
        }
        callback(null, true)
    },
})

const uploadScreen = multer({
    limits: {
        fileSize: 25 * 1024 * 1024,
        files: 1,
    },
    fileFilter: function (req, file, callback) {
        var ext = path.extname(file.originalname)
        if (ext !== '.png' && ext !== '.jpg' && ext !== '.gif' && ext !== '.jpeg' && ext !== '.mp4') {
            return callback(new Error('Only images and videos are allowed - png, jpg, gif and mp4'))
        }
        callback(null, true)
    },
})

app.post('/workspaces/:workspaceId/stories/:storyId/custom/theme/uploadWatermarkImage', [setupMongo, uploadImage.single('watermarkImage')], postCustomThemeUploadWatermarkImageHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/screenUpload', [setupMongo, uploadScreen.single('screenUpload'), rev('story', 'screen:upload')], postScreenUploadHandler)


app.post('/workspaces/:workspaceId/stories/:storyId/custom/theme', [setupMongo, rev('story', 'custom:theme')], postCustomThemeHandler)


app.post('/workspaces/:workspaceId/stories/:storyId/custom/misc', [setupMongo, rev('story', 'custom:misc')], postCustomMiscHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/custom/checklist/uploadImage', [setupMongo, uploadImage.single('image')], checklists.uploadImage)
app.post('/workspaces/:workspaceId/stories/:storyId/custom/checklist', [setupMongo, rev('story', 'custom:checklist')], checklists.save)

app.post('/workspaces/:workspaceId/stories/:storyId/custom/security', [setupMongo, rev('story', 'custom:security')], postCustomSecurityHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/custom/background', [setupMongo, rev('story', 'custom:background')], postCustomBackgroundHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/custom/backgroundMusic', [setupMongo, rev('story', 'custom:music')], postCustomBackgroundMusicHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/custom/backgroundMusic/uploadBackgroundMusic', [setupMongo, uploadAudio.single('backgroundMusic')], postCustomBackgroundMusicUploadHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/custom/variables', [setupMongo, rev('story', 'variables:add')], postCustomVariablesHandler)

app.patch('/workspaces/:workspaceId/stories/:storyId/custom/variables/:varId', [setupMongo, rev('story', 'variables:update')], patchCustomVariablesHandler)

app.delete('/workspaces/:workspaceId/stories/:storyId/custom/variables/:varId', [setupMongo, rev('story', 'variables:delete')], deleteCustomVariablesHandler)


app.post('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/editText', [setupMongo], postScreenEditTextHandler)

app.patch('/workspaces/:workspaceId/stories/:storyId/screens/:screenId', [setupMongo, rev('screen', 'screen:update')], patchScreenHandler)

app.patch('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/popups', [setupMongo, rev('screen', 'popups:update')], patchScreenPopupsHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/updateScreenOrder', [setupMongo, rev('story', 'screens:reorder')], postStoryUpdateScreenOrderHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/updateStepOrder', [setupMongo, rev('screen', 'steps:reorder')], postStoryUpdateStepOrderHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/undo', [setupMongo], postStoryUndoHandler)
app.post('/workspaces/:workspaceId/stories/:storyId/redo', [setupMongo], postStoryRedoHandler)
app.get('/workspaces/:workspaceId/stories/:storyId/history', [setupMongo], getStoryHistoryHandler)
app.post('/workspaces/:workspaceId/stories/:storyId/history/:revisionId/revert', [setupMongo], postStoryRevertHandler)


app.post('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/copy', [setupMongo, rev('story', 'screen:copy')], postScreenCopyHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/baseMerge', [setupMongo], postScreenBaseMergeHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/createScreenFromFrame', [setupMongo, rev('story', 'screen:fromFrame')], postCreateScreenFromFrameHandler)

app.get('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/preview', [setupMongo], getScreenPreviewHandler)

app.get('/workspaces/:workspaceId/stories/:storyId/preview', [setupMongo], getStoryPreviewHandler)

// Step creation
app.post('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/steps', [setupMongo, rev('screen', 'step:add')], postStepsHandler)

app.delete('/workspaces/:workspaceId/stories/:storyId/screens/:screenId', [setupMongo, rev('story', 'screen:delete', { fullScreens: true })], deleteScreenHandler)

app.delete('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/steps/:stepId', [setupMongo, rev('screen', 'step:delete')], deleteStepHandler)

app.patch('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/steps/:stepId', [setupMongo, rev('screen', 'step:update')], patchStepHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/steps/:stepId/uploadAudio', [setupMongo, uploadAudio.single('audioFile'), rev('screen', 'audio:upload')], postStepUploadAudioHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/steps/:stepId/previewImage', [setupMongo, uploadImage.single('previewImage')], postStepPreviewImageHandler)

app.post('/workspaces/:workspaceId/forms', [setupMongo], postFormsHandler)

app.patch('/workspaces/:workspaceId/forms/:formId', [setupMongo], patchFormHandler)

app.post('/workspaces/:workspaceId/forms/:formId/fields', [setupMongo], postFormFieldsHandler)

app.patch('/workspaces/:workspaceId/forms/:formId/fields/:fieldId', [setupMongo], patchFormFieldsHandler)

app.delete('/workspaces/:workspaceId/forms/:formId/fields/:fieldId', [setupMongo], deleteFormFieldsHandler)

app.post('/leads/forms/:formId/', [setupMongo], postLeadsFormHandler)

app.get('/preview/:storyId', [setupMongo], getPreviewStoryHandler)

app.get('/oembed', [setupMongo], getLiveDemoOEmbedHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/publish', [setupMongo], postStoryPublishHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/sessions', [setupMongo], postStorySessionHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/sessions/:sessionId/events', [setupMongo], postStorySessionEventsHandler)

app.get('/workspaces/:workspaceId/stories/:storyId/sessions/:sessionId/events', [setupMongo], getStorySessionEventsHandler)

app.post('/workspaces/:workspaceId/library/uploadScreenshot', [setupMongo], postWorkspaceLibraryUploadScreenshotHandler)
app.post('/workspaces/:workspaceId/library/uploadVideo', [setupMongo], postWorkspaceLibraryUploadVideoHandler)
app.post('/workspaces/:workspaceId/library/uploadPage', [setupMongo], postWorkspaceLibraryUploadPageHandler)

app.post('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/steps/:stepId/zoomSpans', [setupMongo, rev('screen', 'stepZoom:add')], postStepZoomSpansHandler)
app.patch('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/steps/:stepId/zoomSpans/:zoomSpanId', [setupMongo, rev('screen', 'stepZoom:update')], patchStepZoomSpanHandler)
app.post('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/zoomSpans', [setupMongo, rev('screen', 'zoom:add')], postZoomSpansHandler)
app.patch('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/zoomSpans/:zoomSpanId', [setupMongo, rev('screen', 'zoom:update')], patchZoomSpanHandler)
app.delete('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/zoomSpans/:zoomSpanId', [setupMongo, rev('screen', 'zoom:delete')], deleteZoomSpanHandler)
app.delete('/workspaces/:workspaceId/stories/:storyId/screens/:screenId/steps/:stepId/zoomSpans/:zoomSpanId', [setupMongo, rev('screen', 'stepZoom:delete')], deleteStepZoomSpanHandler)


app.post('/workspaces/:workspaceId/stories/:storyId/links', [setupMongo], postStoryLinksHandler)

app.patch('/workspaces/:workspaceId/stories/:storyId/links/:linkId', [setupMongo], patchStoryLinkHandler)

app.delete('/workspaces/:workspaceId/stories/:storyId/links/:linkId', [setupMongo], deleteStoryLinkHandler)

app.get('/workspaces/:workspaceId/stories/:storyId/links', [setupMongo], getStoryLinksHandler)

app.post('/workspaces/:workspaceId/auto-recordings', [setupMongo], postAutoRecordingsHandler)
app.get('/workspaces/:workspaceId/auto-recordings', [setupMongo], getAutoRecordingsHandler)
app.get('/workspaces/:workspaceId/auto-recordings/:autoRecordingId', [setupMongo], getAutoRecordingByIdHandler)
app.post('/workspaces/:workspaceId/auto-recordings/:autoRecordingId/events', [setupMongo], postAutoRecordingsEventsHandler)
app.post('/workspaces/:workspaceId/auto-recordings/:autoRecordingId/complete', [setupMongo], postAutoRecordingsCompleteHandler)

app.post('/workspaces/:workspaceId/demo-suggestions/:demoSuggestionId/generate-livedemo', [setupMongo], postDemoSuggestionsGenerateLiveDemoHandler)

// app.post('/workspaces/:workspaceId/stories/:storyId/addScreen', [setupMongo], postStoryAddScreenHandler)

// ---------------------------------------------------------------------------
// AI Demo Agents — workspace-scoped editor routes (auth inside every handler)
const arev = captureAgentRevision

app.post('/workspaces/:workspaceId/agents', [setupMongo], postAgentHandler)
app.get('/workspaces/:workspaceId/agents', [setupMongo], getAgentsHandler)
app.get('/workspaces/:workspaceId/agents/:agentId', [setupMongo], getAgentByIdHandler)
app.patch('/workspaces/:workspaceId/agents/:agentId', [setupMongo, arev('agent:update')], patchAgentHandler)
app.delete('/workspaces/:workspaceId/agents/:agentId', [setupMongo], deleteAgentHandler)
app.post('/workspaces/:workspaceId/agents/:agentId/publish', [setupMongo], postAgentPublishHandler)
app.get('/workspaces/:workspaceId/anam-avatars', [setupMongo], getAnamAvatarsHandler)
app.get('/workspaces/:workspaceId/anam-voices', [setupMongo], getAnamVoicesHandler)
app.get('/workspaces/:workspaceId/lemonslice-avatars', [setupMongo], getLemonSliceAvatarsHandler)
const uploadAvatarImage = multer({
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, callback) => callback(null, !!AVATAR_IMAGE_TYPES[file.mimetype]),
})
app.post('/workspaces/:workspaceId/lemonslice-avatars', [setupMongo, uploadAvatarImage.single('image')], postLemonSliceAvatarHandler)
const uploadPreviewContent = multer({
    limits: { fileSize: 25 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, callback) => callback(null, !!PREVIEW_TYPES[file.mimetype]),
})
app.post('/workspaces/:workspaceId/agents/:agentId/embed/preview-image', [setupMongo, uploadPreviewContent.single('image'), arev('agent:update')], postAgentEmbedPreviewImageHandler)
app.delete('/workspaces/:workspaceId/lemonslice-avatars/:avatarId([a-f0-9]{24})', [setupMongo], deleteLemonSliceAvatarHandler)
app.post('/workspaces/:workspaceId/lemonslice-avatars/:avatarId([a-f0-9]{24})/clip', [setupMongo], postLemonSliceAvatarClipHandler)

const uploadKnowledgeFile = multer({
    limits: {
        fileSize: 20 * 1024 * 1024,
        // Imported chunks ride along as a JSON field: ~15KB of embedding each
        fieldSize: 100 * 1024 * 1024,
        files: 1,
    },
    fileFilter: function (req, file, callback) {
        const ext = path.extname(file.originalname).toLowerCase()
        if (!['.pdf', '.md', '.txt', '.html', '.htm'].includes(ext)) {
            return callback(new Error('Only pdf, md, txt and html files are allowed'))
        }
        callback(null, true)
    },
})

app.post('/workspaces/:workspaceId/agents/:agentId/knowledge', [setupMongo, uploadKnowledgeFile.single('file'), arev('knowledge:add')], postAgentKnowledgeHandler)
app.get('/workspaces/:workspaceId/agents/:agentId/knowledge', [setupMongo], getAgentKnowledgeHandler)
app.patch('/workspaces/:workspaceId/agents/:agentId/knowledge/:sourceId', [setupMongo, arev('knowledge:update')], patchAgentKnowledgeHandler)
app.delete('/workspaces/:workspaceId/agents/:agentId/knowledge/:sourceId', [setupMongo, arev('knowledge:delete')], deleteAgentKnowledgeHandler)
app.post('/workspaces/:workspaceId/agents/:agentId/knowledge/reindex', [setupMongo], postAgentKnowledgeReindexHandler)
app.post('/workspaces/:workspaceId/agents/:agentId/knowledge/:sourceId/reindex', [setupMongo], postAgentKnowledgeReindexHandler)
app.get('/workspaces/:workspaceId/agents/:agentId/knowledge/:sourceId/preview', [setupMongo], agentKnowledgeInsights.preview)
app.get('/workspaces/:workspaceId/agents/:agentId/knowledge-gaps', [setupMongo], agentKnowledgeInsights.gaps)
app.post('/workspaces/:workspaceId/agents/:agentId/knowledge-gaps/draft', [setupMongo], agentKnowledgeInsights.draftFaq)

// Outbound webhooks + Slack (Settings > Integrations)
app.get('/workspaces/:workspaceId/webhooks', [setupMongo, sessionOnly], workspaceWebhooks.list)
app.post('/workspaces/:workspaceId/webhooks', [setupMongo, sessionOnly], workspaceWebhooks.create)
app.patch('/workspaces/:workspaceId/webhooks/:webhookId', [setupMongo, sessionOnly], workspaceWebhooks.update)
app.delete('/workspaces/:workspaceId/webhooks/:webhookId', [setupMongo, sessionOnly], workspaceWebhooks.remove)
app.post('/workspaces/:workspaceId/webhooks/:webhookId/test', [setupMongo, sessionOnly], workspaceWebhooks.test)
app.get('/workspaces/:workspaceId/agent-emails', [setupMongo], agentEmails.list)
app.post('/workspaces/:workspaceId/agents/:agentId/summary-email/preview', [setupMongo], agentEmails.preview)
app.get('/workspaces/:workspaceId/email-settings', [setupMongo], agentEmails.getSettings)
app.put('/workspaces/:workspaceId/email-settings', [setupMongo], agentEmails.putSettings)
app.post('/workspaces/:workspaceId/email-settings/test', [setupMongo], agentEmails.testSettings)
app.get('/workspaces/:workspaceId/provider-keys', [setupMongo, sessionOnly], providerKeys.get)
app.put('/workspaces/:workspaceId/provider-keys/:provider', [setupMongo, sessionOnly], providerKeys.put)
app.delete('/workspaces/:workspaceId/provider-keys/:provider', [setupMongo, sessionOnly], providerKeys.remove)

// Personal API keys (MCP server, scripts) — Settings > API keys
app.get('/users/api-keys', [setupMongo, sessionOnly], apiKeys.list)
app.post('/users/api-keys', [setupMongo, sessionOnly], apiKeys.create)
app.delete('/users/api-keys/:keyId', [setupMongo, sessionOnly], apiKeys.remove)

// OAuth 2.1 for MCP connectors (Claude.ai, ChatGPT)
app.get('/.well-known/oauth-authorization-server', oauth.metadata)
app.post('/oauth/register', [setupMongo], oauth.register)
app.get('/oauth/authorize', [setupMongo], oauth.authorize)
app.post('/oauth/authorize/decision', [setupMongo, sessionOnly], oauth.decision)
app.post('/oauth/token', [setupMongo], oauth.token)

// SAML SSO (Growth) — Settings > Single sign-on
app.get('/workspaces/:workspaceId/sso', [setupMongo, sessionOnly], sso.get)
app.put('/workspaces/:workspaceId/sso', [setupMongo, sessionOnly], sso.put)
app.post('/workspaces/:workspaceId/sso/domains', [setupMongo, sessionOnly], sso.addDomain)
app.post('/workspaces/:workspaceId/sso/domains/verify', [setupMongo, sessionOnly], sso.verifyDomain)
app.delete('/workspaces/:workspaceId/sso/domains/:domain', [setupMongo, sessionOnly], sso.removeDomain)
app.post('/sso/discover', [setupMongo], sso.discover)
app.get('/sso/:workspaceId/metadata', [setupMongo], sso.metadata)
app.get('/sso/:workspaceId/login', [setupMongo], sso.login)
app.post('/sso/:workspaceId/acs', [setupMongo], sso.acs)

// Custom domain for public links (Growth, Cloudflare for SaaS) — Settings > Custom domain
app.get('/workspaces/:workspaceId/custom-domain', [setupMongo, sessionOnly], customDomainHandlers.get)
app.put('/workspaces/:workspaceId/custom-domain', [setupMongo, sessionOnly], customDomainHandlers.put)
app.post('/workspaces/:workspaceId/custom-domain/verify', [setupMongo, sessionOnly], customDomainHandlers.verify)
app.delete('/workspaces/:workspaceId/custom-domain', [setupMongo, sessionOnly], customDomainHandlers.remove)
app.get('/agent-emails/unsubscribe/:token', [setupMongo], agentEmails.unsubscribePage)
app.post('/agent-emails/unsubscribe/:token', [setupMongo], agentEmails.unsubscribe)

app.post('/workspaces/:workspaceId/agents/:agentId/undo', [setupMongo], postAgentUndoHandler)
app.post('/workspaces/:workspaceId/agents/:agentId/redo', [setupMongo], postAgentRedoHandler)
app.get('/workspaces/:workspaceId/agents/:agentId/history', [setupMongo], getAgentHistoryHandler)
app.post('/workspaces/:workspaceId/agents/:agentId/history/:revisionId/revert', [setupMongo], postAgentRevertHandler)

// Editor twins of the visitor endpoints — auth + workspace proven, mode 'editor'
app.post('/workspaces/:workspaceId/agents/:agentId/chat', [setupMongo], postAgentChatHandler)
app.post('/workspaces/:workspaceId/agents/:agentId/tts', [setupMongo], postAgentTtsHandler)
app.post('/workspaces/:workspaceId/agents/:agentId/transcribe', [setupMongo], postAgentTranscribeHandler)
app.post('/workspaces/:workspaceId/agents/:agentId/session', [setupMongo, agentEditorMode], postAgentSessionHandler)
// Auth-optional: members get editor mode, anonymous gets published (or 401 on drafts)
app.get('/workspaces/:workspaceId/agents/:agentId/preview', [setupMongo, corsMiddleware, agentEditorModeOptional], getAgentPreviewHandler)
app.get('/workspaces/:workspaceId/agents/:agentId/player', [setupMongo, corsMiddleware, agentEditorModeOptional], getAgentPlayerHandler)

// Agent analytics (editor)
app.get('/workspaces/:workspaceId/agent-sessions', [setupMongo], getWorkspaceAgentSessionsHandler)
app.get('/workspaces/:workspaceId/agents/:agentId/sessions', [setupMongo], getAgentSessionsHandler)
app.get('/workspaces/:workspaceId/agents/:agentId/sessions/:sessionId', [setupMongo], getAgentSessionByIdHandler)
app.get('/workspaces/:workspaceId/agents/:agentId/sessions/:sessionId/recording', [setupMongo], getAgentSessionRecordingHandler)

// Public visitor routes — loadPublicAgent gates all of them (isPublished or member)
app.get('/agents/:agentId/preview', [setupMongo, corsMiddleware], getAgentPreviewHandler)
app.get('/agents/:agentId/player', [setupMongo, corsMiddleware], getAgentPlayerHandler)
app.post('/agents/:agentId/session', [setupMongo, corsMiddleware], postAgentSessionHandler)
app.post('/agents/:agentId/chat', [setupMongo, corsMiddleware], postAgentChatHandler)
app.post('/agents/:agentId/tts', [setupMongo, corsMiddleware], postAgentTtsHandler)
app.post('/agents/:agentId/transcribe', [setupMongo, corsMiddleware], postAgentTranscribeHandler)
app.post('/agents/:agentId/ack', [setupMongo, corsMiddleware], postAgentAckHandler)
app.post('/agents/:agentId/sessions/:agentSessionId/recording-events', [setupMongo, corsMiddleware], postAgentRecordingEventsHandler)
app.post('/agents/:agentId/anam-session', [setupMongo, corsMiddleware], postAnamSessionHandler)
app.post('/agents/:agentId/lemonslice-session', [setupMongo, corsMiddleware], postLemonSliceSessionHandler)
app.post('/agents/:agentId/avatar-usage/:usageId/heartbeat', [setupMongo, corsMiddleware], postAvatarUsageHeartbeatHandler)
app.post('/agents/:agentId/avatar-usage/:usageId/end', [setupMongo, corsMiddleware], postAvatarUsageEndHandler)
app.get('/workspaces/:workspaceId/avatar-usage', [setupMongo, sessionOnly], getWorkspaceAvatarUsageHandler)
// Shareable conversation recap (token = AgentSession.recapToken)
app.get('/recaps/:token', [setupMongo], agentRecap.view)
app.post('/recaps/:token/viewers', [setupMongo], agentRecap.addViewer)
// ---------------------------------------------------------------------------

// Showcases (multi-demo hubs) — editor routes, auth inside every handler
app.post('/workspaces/:workspaceId/showcases', [setupMongo], showcases.create)
app.get('/workspaces/:workspaceId/showcases', [setupMongo], showcases.list)
app.get('/workspaces/:workspaceId/showcases/:showcaseId', [setupMongo], showcases.get)
app.patch('/workspaces/:workspaceId/showcases/:showcaseId', [setupMongo], showcases.patch)
app.delete('/workspaces/:workspaceId/showcases/:showcaseId', [setupMongo], showcases.remove)
app.post('/workspaces/:workspaceId/showcases/:showcaseId/publish', [setupMongo], showcases.publish)
// Visitor routes (published, or Bearer + member). Events arrive via sendBeacon as text/plain.
app.get('/showcases/:showcaseId/player', [setupMongo, corsMiddleware], getShowcasePlayerHandler)
app.post('/showcases/:showcaseId/sessions', [setupMongo, corsMiddleware], showcases.createSession)
app.post('/showcases/:showcaseId/sessions/:sessionId/events', [setupMongo, corsMiddleware, express.text({ type: 'text/plain', limit: '64kb' })], showcases.postEvents)
// "Make it yours" templates — author routes (auth inside) + public claim routes used by the web-app preview pages
app.put('/workspaces/:workspaceId/stories/:id/ownable', [setupMongo], ownClaims.putOwnable('story'))
app.put('/workspaces/:workspaceId/agents/:id/ownable', [setupMongo], ownClaims.putOwnable('agent'))
app.put('/workspaces/:workspaceId/showcases/:id/ownable', [setupMongo], ownClaims.putOwnable('showcase'))
app.get('/workspaces/:workspaceId/stories/:id/ownable/preview-count', [setupMongo], ownClaims.getPreviewCount('story'))
app.get('/workspaces/:workspaceId/agents/:id/ownable/preview-count', [setupMongo], ownClaims.getPreviewCount('agent'))
app.get('/workspaces/:workspaceId/showcases/:id/ownable/preview-count', [setupMongo], ownClaims.getPreviewCount('showcase'))
app.get('/workspaces/:workspaceId/own-claims/analytics', [setupMongo], ownClaims.getAnalytics)
app.get('/own-claims/eligibility', [setupMongo], ownClaims.getEligibility)
app.post('/own-claims', [setupMongo], ownClaims.postClaim)
app.get('/own-claims/:claimId', [setupMongo], ownClaims.getClaim)
// StoryDemo checklist viewer progress. The token is the capability; events arrive via sendBeacon as text/plain.
app.post('/checklists/:hostStoryId/progress', [setupMongo, corsMiddleware], checklists.start)
app.post('/checklists/:hostStoryId/progress/:token/events', [setupMongo, corsMiddleware, express.text({ type: 'text/plain', limit: '64kb' })], checklists.postEvents)
// ---------------------------------------------------------------------------

// Sandbox StoryDemos — editor routes, auth inside every handler. Player: getStoryPreview -> getSandboxPreview
app.patch('/workspaces/:workspaceId/stories/:storyId/sandbox', [setupMongo, rev('story', 'sandbox:update')], sandbox.patchSandbox)
app.get('/workspaces/:workspaceId/stories/:storyId/sandbox/links', [setupMongo], sandbox.getLinks)
app.post('/workspaces/:workspaceId/stories/:storyId/sandbox/screens/:screenId/links', [setupMongo, rev('screen', 'link:add')], sandbox.postLink)
app.patch('/workspaces/:workspaceId/stories/:storyId/sandbox/screens/:screenId/links/:linkId', [setupMongo, rev('screen', 'link:update')], sandbox.patchLink)
app.delete('/workspaces/:workspaceId/stories/:storyId/sandbox/screens/:screenId/links/:linkId', [setupMongo, rev('screen', 'link:delete')], sandbox.deleteLink)
app.post('/workspaces/:workspaceId/stories/:storyId/sandbox/screens/:screenId/merge', [setupMongo, rev('story', 'sandbox:merge', { fullScreens: true })], sandbox.mergeScreen)
app.delete('/workspaces/:workspaceId/stories/:storyId/sandbox/screens/:screenId', [setupMongo, rev('story', 'sandbox:screenDelete', { fullScreens: true })], sandbox.deleteScreen)
// ---------------------------------------------------------------------------

// Public tutorial search — no auth required, IP rate-limited (5 req/s/IP)
// Supports ?q=<term> for search and ?featured=true for carousel data
app.get('/tutorials/search', [setupMongo, corsMiddleware], getTutorialsSearchHandler)

// URL demo processing — no auth required, IP rate-limited (3 req/min/IP)
app.post('/urldemos', [setupMongo, corsMiddleware], postUrlDemosHandler)
app.get('/urldemos/:urlDemoId', [setupMongo, corsMiddleware], getUrlDemosHandler)

// Cloned Storylane / Arcade / Navattic / Supademo demos — public landing form (3 req/min/IP, 5/day/email)
app.post('/migratedemos', [setupMongo, corsMiddleware], migrateDemos.postMigrateDemo)
app.get('/migratedemos/:migrateDemoId', [setupMongo, corsMiddleware], migrateDemos.getMigrateDemo)
// livedemo-ai-api only: Authorization: Internal <INTERNAL_API_KEY>, no CORS
app.post('/internal/workspaces/:workspaceId/stories/import', [setupMongo], migrateDemos.postInternalStoryImport)
app.post('/internal/migratedemos/:migrateDemoId/emails', [setupMongo], migrateDemos.postInternalEmails)
app.post('/internal/migratedemos/:migrateDemoId/claims', [setupMongo], migrateDemos.postInternalClaims)

console.log(ENV.ENV)
let server
if (ENV.ENV === 'dev1') {
    server = https.createServer(options, app)
} else {
    server = http.createServer(app)
}

async function setup() {
    conn = await setupDB()
    Models = getModels(conn)
    await ensureAgentVectorIndex(conn)

    await new Promise((resolve) => {
        const port = 3005
        server.listen(port, () => {
            console.log('Story server started on port ', port)
            resolve()
        })
    })
}


if (ENV.ENABLE_CONSUMER) {
    setupWorkers()
}

if (ENV.ENABLE_API) {
    setup()
}

// import io from 'socket.io'(http, {
//   maxHttpBufferSize: 1e8 * 100
// })

