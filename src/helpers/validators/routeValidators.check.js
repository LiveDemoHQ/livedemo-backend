// Self-check for the route validators. Run: node src/helpers/validators/routeValidators.check.js
// Each `ok` payload is what a real client sends today (web-app, embed, chrome extension,
// OAuth/SAML/Google), so a schema change that would 400 a live caller fails here.
import assert from 'assert'

import postAgentValidator from './agents/postAgentValidator.js'
import patchAgentValidator from './agents/patchAgentValidator.js'
import postAgentPublishValidator from './agents/postAgentPublishValidator.js'
import postAgentChatValidator from './agents/postAgentChatValidator.js'
import postAgentSessionValidator from './agents/postAgentSessionValidator.js'
import postAgentAckValidator from './agents/postAgentAckValidator.js'
import postAgentTtsValidator from './agents/postAgentTtsValidator.js'
import postSummaryEmailPreviewValidator from './agents/postSummaryEmailPreviewValidator.js'
import postAgentKnowledgeValidator from './agents/knowledge/postAgentKnowledgeValidator.js'
import patchAgentKnowledgeValidator from './agents/knowledge/patchAgentKnowledgeValidator.js'
import postKnowledgeGapDraftValidator from './agents/knowledge/postKnowledgeGapDraftValidator.js'
import postRecapViewerValidator from './agents/recaps/postRecapViewerValidator.js'
import putOwnableValidator from './ownable/putOwnableValidator.js'
import postOwnClaimValidator from './ownable/postOwnClaimValidator.js'
import putEmailSettingsValidator from './workspaces/putEmailSettingsValidator.js'
import postLemonSliceAvatarValidator from './workspaces/postLemonSliceAvatarValidator.js'
import putProviderKeyValidator from './workspaces/putProviderKeyValidator.js'
import putCustomDomainValidator from './workspaces/putCustomDomainValidator.js'
import putSsoValidator from './workspaces/sso/putSsoValidator.js'
import postSsoDomainValidator from './workspaces/sso/postSsoDomainValidator.js'
import postSsoDiscoverValidator from './workspaces/sso/postSsoDiscoverValidator.js'
import postSsoAcsValidator from './workspaces/sso/postSsoAcsValidator.js'
import postWorkspaceTagValidator from './workspaces/tags/postWorkspaceTagValidator.js'
import postWorkspaceTagAssignValidator from './workspaces/tags/postWorkspaceTagAssignValidator.js'
import postWorkspaceWebhookValidator from './workspaces/webhooks/postWorkspaceWebhookValidator.js'
import patchWorkspaceWebhookValidator from './workspaces/webhooks/patchWorkspaceWebhookValidator.js'
import postShowcaseValidator from './workspaces/showcases/postShowcaseValidator.js'
import patchShowcaseValidator from './workspaces/showcases/patchShowcaseValidator.js'
import postShowcasePublishValidator from './workspaces/showcases/postShowcasePublishValidator.js'
import postShowcaseSessionValidator from './workspaces/showcases/postShowcaseSessionValidator.js'
import postShowcaseEventsValidator from './workspaces/showcases/postShowcaseEventsValidator.js'
import postStoryCloneValidator from './stories/postStoryCloneValidator.js'
import postScreenCopyValidator from './stories/screens/postScreenCopyValidator.js'
import postScreenBaseMergeValidator from './stories/screens/postScreenBaseMergeValidator.js'
import postStepPreviewImageValidator from './stories/screens/steps/postStepPreviewImageValidator.js'
import postDomRecordingEventsValidator from './stories/domRecording/postDomRecordingEventsValidator.js'
import postDomRecordingFinishValidator from './stories/domRecording/postDomRecordingFinishValidator.js'
import patchSandboxValidator from './stories/sandbox/patchSandboxValidator.js'
import postSandboxLinkValidator from './stories/sandbox/postSandboxLinkValidator.js'
import patchSandboxLinkValidator from './stories/sandbox/patchSandboxLinkValidator.js'
import postSandboxMergeScreenValidator from './stories/sandbox/postSandboxMergeScreenValidator.js'
import postApiKeyValidator from './users/postApiKeyValidator.js'
import postUsersAuthGoogleLinkValidator from './users/postUsersAuthGoogleLinkValidator.js'
import postUsersAuthGoogleOneTapValidator from './users/postUsersAuthGoogleOneTapValidator.js'
import postCheckoutSessionValidator from './payments/postCheckoutSessionValidator.js'
import postVerifyCheckoutSessionValidator from './payments/postVerifyCheckoutSessionValidator.js'
import postVerifyPaymentChargeValidator from './payments/postVerifyPaymentChargeValidator.js'
import postOAuthRegisterValidator from './oauth/postOAuthRegisterValidator.js'
import postOAuthDecisionValidator from './oauth/postOAuthDecisionValidator.js'
import postOAuthTokenValidator from './oauth/postOAuthTokenValidator.js'

const ID = '64b7f0c2a1b2c3d4e5f60718'
const ID2 = '64b7f0c2a1b2c3d4e5f60719'

function ok(name, validate, body) {
  const { error } = validate(body)
  assert.ok(!error, `${name} should accept ${JSON.stringify(body).slice(0, 160)}: ${error && error.message}`)
}
function bad(name, validate, body) {
  const { error } = validate(body)
  assert.ok(error, `${name} should reject ${JSON.stringify(body).slice(0, 160)}`)
}

// --- agents --------------------------------------------------------------------
ok('postAgent', postAgentValidator, { name: 'Untitled agent' })
ok('postAgent', postAgentValidator, { templateId: 'meeting_booker' })
bad('postAgent', postAgentValidator, { name: 'x', owner: 'someone' })

// PersonaTab form, GoalTab (qualification fields carry keyLocked), SummarySettings, DemosTab, ShareDropdown
ok('patchAgent persona', patchAgentValidator, {
  welcomeMessage: 'Hi', starterQuestions: ['A', ''], systemPrompt: '', voiceEnabled: true, voiceId: 'v1',
  avatarsEnabled: false, anamAvatarId: '', avatarProvider: 'anam', lemonsliceAvatarId: '', avatarVoice: 'elevenlabs',
  anamVoiceId: '', visitorCapture: { enabled: true, requireName: false, requireEmail: true }, recapEnabled: true,
})
ok('patchAgent goal', patchAgentValidator, {
  goal: { flow: 'book_meeting', intensity: 'balanced', afterTurns: null, stageInstructions: {} },
  cta: { bookMeetingUrl: 'https://calendly.com/a/b', startTrialUrl: '', inlineCalendar: true },
  qualification: { enabled: true, gateBooking: true, fields: [{ key: 'team_size', label: 'Team size', keyLocked: true }] },
})
ok('patchAgent summary', patchAgentValidator, { summaryEmail: { enabled: true, subject: '', body: '' } })
ok('patchAgent idle', patchAgentValidator, { summaryIdleMinutes: 15 })
ok('patchAgent demos', patchAgentValidator, { allowedDemoIds: [ID], defaultDemoId: ID })
ok('patchAgent clear default', patchAgentValidator, { defaultDemoId: null })
ok('patchAgent embed', patchAgentValidator, { embed: { enabled: true, pill: { size: 'large' } } })
ok('patchAgent theme', patchAgentValidator, { theme: 'dark-blur' })
bad('patchAgent theme', patchAgentValidator, { theme: 'neon' })
bad('patchAgent unknown', patchAgentValidator, { isPublished: true })
bad('patchAgent ids', patchAgentValidator, { allowedDemoIds: ['nope'] })

ok('postAgentPublish', postAgentPublishValidator, { isPublished: false })
bad('postAgentPublish', postAgentPublishValidator, {})

// AgentChatPanel sends demoId / stepNumber as null before a demo opens
ok('postAgentChat', postAgentChatValidator, { sessionId: ID, message: 'hi', source: 'text', demoId: null, stepNumber: null })
ok('postAgentChat', postAgentChatValidator, { sessionId: ID, message: 'next', source: 'suggestion', demoId: ID, stepNumber: 3 })
bad('postAgentChat', postAgentChatValidator, { sessionId: ID, message: 'hi', source: 'telepathy' })
bad('postAgentChat', postAgentChatValidator, { message: 'hi' })

// agentInjectScript: plain link, then embed with host-identified visitor
ok('postAgentSession', postAgentSessionValidator, {})
ok('postAgentSession', postAgentSessionValidator, {
  visitor: { name: 'Ada', email: 'ada@x.com', plan: 'pro' },
  personalization: { acct: null, company: 'Acme' },
  source: { channel: 'embed', trigger: 'pill', pageUrl: 'https://x.com/pricing', referrer: '', utm: { utm_source: 'g' } },
  capturedVia: 'embed_identify',
})

ok('postAgentAck', postAgentAckValidator, { sessionId: ID, type: 'cta_clicked', data: { cta: 'bookMeeting', via: 'agent' } })
ok('postAgentAck', postAgentAckValidator, { sessionId: ID, type: 'calendar_dismissed', data: {} })
bad('postAgentAck', postAgentAckValidator, { type: 'cta_clicked' })

ok('postAgentTts', postAgentTtsValidator, { text: 'Hey, welcome!' })
ok('postSummaryEmailPreview', postSummaryEmailPreviewValidator, {})
ok('postSummaryEmailPreview', postSummaryEmailPreviewValidator, { subject: 'Recap', body: 'Hi {{name}}' })

// KnowledgeTab JSON, and multipart (every field a string)
ok('postAgentKnowledge text', postAgentKnowledgeValidator, { type: 'text', title: 'Notes', rawText: 'abc' })
ok('postAgentKnowledge faq', postAgentKnowledgeValidator, { type: 'faq', title: 'FAQ', faq: [{ q: 'a', a: 'b' }] })
ok('postAgentKnowledge site', postAgentKnowledgeValidator, { type: 'site', url: 'https://x.com', maxPages: '20', refreshHours: '24' })
ok('postAgentKnowledge file', postAgentKnowledgeValidator, { type: 'file', title: 'deck.pdf' })
bad('postAgentKnowledge', postAgentKnowledgeValidator, { type: 'video' })
ok('patchAgentKnowledge', patchAgentKnowledgeValidator, { enabled: false })
ok('postKnowledgeGapDraft', postKnowledgeGapDraftValidator, { question: 'Do you support SSO?' })
ok('postRecapViewer', postRecapViewerValidator, { email: 'a@b.co' })

// --- ownable ---------------------------------------------------------------------
ok('putOwnable', putOwnableValidator, { enabled: true, ctaLabel: '', claimTokenTtlHours: 2, includeKnowledge: true })
ok('putOwnable story', putOwnableValidator, { enabled: false, ctaLabel: 'Make it yours', claimTokenTtlHours: 24 })
bad('putOwnable', putOwnableValidator, { ctaLabel: 'x' })
ok('postOwnClaim', postOwnClaimValidator, { sourceKind: 'agent', sourceId: ID, claimToken: 'tok', browserSessionId: 'abc', workspaceId: undefined })
ok('postOwnClaim', postOwnClaimValidator, { sourceKind: 'story', sourceId: ID, claimToken: 'tok', browserSessionId: 'abc', workspaceId: ID2 })

// --- workspaces ------------------------------------------------------------------
ok('putEmailSettings', putEmailSettingsValidator, { mode: 'livedemo', smtp: { password: '' } })
ok('putEmailSettings smtp', putEmailSettingsValidator, { mode: 'smtp', smtp: { host: 'smtp.x.com', port: 587, user: 'u', fromEmail: 'a@x.com', fromName: 'A', replyTo: '', password: 'p', hasPassword: true } })
bad('putEmailSettings', putEmailSettingsValidator, { mode: 'carrier-pigeon' })
ok('postLemonSliceAvatar', postLemonSliceAvatarValidator, { name: 'Face' })
ok('putProviderKey', putProviderKeyValidator, { apiKey: 'sk_123' })
ok('putCustomDomain', putCustomDomainValidator, { hostname: 'demo.acme.com' })
ok('putSso idp', putSsoValidator, { idpSsoUrl: 'https://acme.okta.com/sso', idpEntityId: 'x', idpCert: 'MII...' })
ok('putSso toggle', putSsoValidator, { enabled: true })
ok('putSso from GET', putSsoValidator, { idpSsoUrl: undefined, idpEntityId: null, idpCert: '' })
ok('postSsoDomain', postSsoDomainValidator, { domain: 'acme.com' })
ok('postSsoDiscover', postSsoDiscoverValidator, { email: 'a@acme.com' })
ok('postSsoAcs', postSsoAcsValidator, { SAMLResponse: 'PHNhbWw...', RelayState: '', Signature: 'x' })
ok('postWorkspaceTag', postWorkspaceTagValidator, { name: 'Q3' })
ok('postWorkspaceTagAssign', postWorkspaceTagAssignValidator, { kind: 'agent', ids: [ID], tagId: ID2, on: true })
bad('postWorkspaceTagAssign', postWorkspaceTagAssignValidator, { kind: 'agent', ids: [ID], tagId: ID2 })
ok('postWorkspaceWebhook', postWorkspaceWebhookValidator, { kind: 'webhook', url: 'https://h.com/x', measurementId: '', apiSecret: '', writeKey: '', events: ['session.ended'] })
ok('patchWorkspaceWebhook', patchWorkspaceWebhookValidator, { enabled: false })

// --- showcases -----------------------------------------------------------------
ok('postShowcase', postShowcaseValidator, { name: 'Untitled gallery', layout: 'gallery' })
ok('patchShowcase', patchShowcaseValidator, { gallery: { columns: 3 } })
ok('patchShowcase', patchShowcaseValidator, { facets: [], items: [] })
bad('patchShowcase', patchShowcaseValidator, { workspaceId: ID })
ok('postShowcasePublish', postShowcasePublishValidator, { isPublished: true })
ok('postShowcaseSession', postShowcaseSessionValidator, { delivery: 'embed', referrer: '', utm: {} })
ok('postShowcaseEvents', postShowcaseEventsValidator, { events: [{ type: 'item_opened', itemId: ID }] })
ok('postShowcaseEvents beacon parse failed', postShowcaseEventsValidator, {})

// --- stories -------------------------------------------------------------------
ok('postStoryClone', postStoryCloneValidator, {})
ok('postStoryClone', postStoryCloneValidator, { workspaceId: ID, name: 'Copy' })
ok('postScreenCopy', postScreenCopyValidator, {})
ok('postScreenCopy', postScreenCopyValidator, { afterScreenId: ID })
ok('postScreenBaseMerge', postScreenBaseMergeValidator, { afterScreenId: null })
ok('postStepPreviewImage multipart', postStepPreviewImageValidator, {})
ok('postStepPreviewImage', postStepPreviewImageValidator, { sourceScreenId: ID })
// chrome extension domDelta.js
const domBatch = { events: [{ type: 2, data: {} }], clickThumbnails: [], viewport: { width: 1440, height: 900 }, href: 'https://app.x.com' }
ok('postDomRecordingEvents', postDomRecordingEventsValidator, domBatch)
ok('postDomRecordingFinish', postDomRecordingFinishValidator, { ...domBatch, events: [] })
ok('postDomRecordingEvents no viewport', postDomRecordingEventsValidator, { events: [], clickThumbnails: [] })
ok('patchSandbox', patchSandboxValidator, { allowEmbed: true })
ok('patchSandbox', patchSandboxValidator, { flows: [{ _id: ID, name: 'Onboarding', screenIds: [ID] }] })
ok('patchSandbox', patchSandboxValidator, { startScreenId: ID })
bad('patchSandbox', patchSandboxValidator, { allowEmbed: 'yes' })
ok('postSandboxLink', postSandboxLinkValidator, { gotoType: 'screen', gotoScreen: ID, gotoFlowId: null, gotoWebsite: '', anchor: { selector: '#a', rect: { x: 1 } } })
ok('patchSandboxLink', patchSandboxLinkValidator, { gotoType: 'website', gotoScreen: null, gotoFlowId: null, gotoWebsite: 'https://x.com' })
bad('postSandboxLink', postSandboxLinkValidator, { anchor: {} })
ok('postSandboxMergeScreen', postSandboxMergeScreenValidator, { intoScreenId: ID })

// --- users / auth --------------------------------------------------------------
ok('postApiKey', postApiKeyValidator, { name: 'CI' })
ok('postUsersAuthGoogleLink', postUsersAuthGoogleLinkValidator, {})
ok('postUsersAuthGoogleOneTap', postUsersAuthGoogleOneTapValidator, { credential: 'jwt', g_csrf_token: 'x', select_by: 'btn' })
bad('postUsersAuthGoogleOneTap', postUsersAuthGoogleOneTapValidator, {})

// --- payments ------------------------------------------------------------------
ok('postCheckoutSession nudge', postCheckoutSessionValidator, { productId: 'prod_1', workspaceId: ID, quantity: 1, freeTrial: true })
ok('postCheckoutSession billing', postCheckoutSessionValidator, { productId: 'prod_1', workspaceId: ID, quantity: 3 })
bad('postCheckoutSession', postCheckoutSessionValidator, { workspaceId: ID })
ok('postVerifyCheckoutSession', postVerifyCheckoutSessionValidator, { sessionId: 'cs_test_1' })
ok('postVerifyPaymentCharge', postVerifyPaymentChargeValidator, { id: 'ch_1' })

// --- oauth (unknown parameters are ignored per RFC) ------------------------------
ok('postOAuthRegister', postOAuthRegisterValidator, { redirect_uris: ['https://c.com/cb'], client_name: 'Claude', grant_types: ['authorization_code'], token_endpoint_auth_method: 'none' })
ok('postOAuthDecision', postOAuthDecisionValidator, { client_id: 'c', redirect_uri: 'https://c.com/cb', response_type: 'code', code_challenge: 'x', code_challenge_method: 'S256', state: 's', scope: 'mcp', approve: true })
ok('postOAuthToken code', postOAuthTokenValidator, { grant_type: 'authorization_code', code: 'c', code_verifier: 'v', redirect_uri: 'https://c.com/cb', client_id: 'c', resource: 'https://api' })
ok('postOAuthToken refresh', postOAuthTokenValidator, { grant_type: 'refresh_token', refresh_token: 'r', scope: 'mcp' })
bad('postOAuthToken', postOAuthTokenValidator, {})

console.log('routeValidators.check: ok')
