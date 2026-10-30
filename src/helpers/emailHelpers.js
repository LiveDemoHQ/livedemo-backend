import crypto from 'crypto'
import ENV from '../envServer.js'
import { sendEmail } from './emails/emailsSender.js'
import Templates from './emails/templates/index.js'
import { EmailVerificationCodeStatuses } from '../models/EmailVerificationCode.js'

import logger from './logger.js'

function generateSixDigitCode() {
  return String(crypto.randomInt(100000, 1000000))
}

function getFirstName(userDoc) {
  const fullNameArray = userDoc.name ? userDoc.name.split(' ') : []
  return fullNameArray.length ? fullNameArray[0] : userDoc.name
}

export async function deactivateCodesForUser(userId, Models) {
  await Models.EmailVerificationCode.updateMany(
    { userId, status: EmailVerificationCodeStatuses.ACTIVE },
    { status: EmailVerificationCodeStatuses.DEACTIVATED }
  )
}

export async function createAndSendEmailVerificationCode(userDoc, Models) {
  await deactivateCodesForUser(userDoc._id, Models)

  const code = generateSixDigitCode()

  const verificationDoc = await new Models.EmailVerificationCode({
    email: userDoc.email,
    userId: userDoc._id,
    code,
    status: EmailVerificationCodeStatuses.ACTIVE,
  }).save()

  const firstName = getFirstName(userDoc)

  await sendEmail(Templates.emailVerification, {
    name: firstName,
    code,
  }, [userDoc.email], Models)
    .catch((err) => {
      logger.error('Email verification send error:', { eventName: 'EMAIL_VERIFICATION_SEND_ERROR', err: err })
    })

  return verificationDoc
}

export function buildUnsubscribeUrl(unsubscribeToken) {
  const serverUrl = (ENV.SERVER_URL || '').replace(/\/$/, '')
  if (!serverUrl || !unsubscribeToken) {
    return ''
  }

  const params = new URLSearchParams({
    unsubscribeToken,
  })

  return `${serverUrl}/unsubscribe?${params.toString()}`
}

// Email verification is optional and never blocks the app; users are only nudged from Settings.
export function shouldRedirectToEmailVerify() {
  return false
}

export function shouldRedirectToOnboarding(userDoc) {
  const onboardingGoals = userDoc?.onboarding?.goals
  return !Array.isArray(onboardingGoals) || onboardingGoals.length === 0
}

// Fresh "Make it yours" / UrlDemo copies land in the editor, not the goals wizard
const JUST_CLAIMED_MS = 15 * 60 * 1000

function firstWorkspaceId(userDoc) {
  const first = userDoc && userDoc.workspaces && userDoc.workspaces[0]
  return first && (first._id || first)
}

async function ownClaimRedirectPath(Models, userId) {
  if (!Models || !Models.OwnClaim || !userId) return null

  const cloning = await Models.OwnClaim.findOne({ userId, status: 'cloning' })
    .sort({ createdAt: -1 })
    .select('_id')
    .lean()
  if (cloning) return `/own/claim/${cloning._id}`

  const justDone = await Models.OwnClaim.findOne({
    userId,
    status: 'completed',
    completedAt: { $gte: new Date(Date.now() - JUST_CLAIMED_MS) }
  })
    .sort({ completedAt: -1 })
    .select('_id')
    .lean()
  return justDone ? `/own/claim/${justDone._id}` : null
}

// cloneUrlDemoStoriesForUser runs inline on auth and creates type:'owned' rows
async function urlDemoRedirectPath(Models, userDoc) {
  if (!Models || !Models.UrlDemo || !userDoc || !userDoc._id) return null
  const workspaceId = firstWorkspaceId(userDoc)
  if (!workspaceId) return null

  const owned = await Models.UrlDemo.findOne({
    userId: userDoc._id,
    type: 'owned',
    status: 'completed',
    storyId: { $exists: true },
    createdAt: { $gte: new Date(Date.now() - JUST_CLAIMED_MS) }
  })
    .sort({ createdAt: -1 })
    .select('storyId')
    .lean()
  return owned && owned.storyId
    ? `/workspace/${workspaceId}/storydemo/${owned.storyId}`
    : null
}

// Marks the user as activated without re-checking. Cheap enough to call from creation handlers.
export async function markUserActivated(Models, userId) {
  if (!Models || !Models.User || !userId) return
  await Models.User.updateOne({ _id: userId, activated: { $ne: true } }, { $set: { activated: true } })
}

// "Activated" = the user has a demo, an AI agent, a cloned copy (Make it yours / migrated) or a
// successful URL demo. It is stored on the user and never reset; until then onboarding is enforced.
// Persisted lazily, so users created before this field existed are fixed on their next login.
export async function isUserActivated(Models, userDoc) {
  if (!Models || !userDoc) return true
  if (userDoc.activated === true) return true

  const workspaceIds = (userDoc.workspaces || []).map((w) => w && (w._id || w)).filter(Boolean)
  const userId = userDoc._id
  const checks = [
    // Cloned or migrated content counts while the copy is still being made
    Models.OwnClaim && Models.OwnClaim.exists({ userId, status: { $in: ['cloning', 'completed'] } }),
    Models.UrlDemo && Models.UrlDemo.exists({ userId, type: 'owned', status: 'completed' }),
    workspaceIds.length && Models.Story && Models.Story.exists({ workspaceId: { $in: workspaceIds }, deletedAt: null }),
    workspaceIds.length && Models.AiDemoAgent && Models.AiDemoAgent.exists({ workspaceId: { $in: workspaceIds }, deletedAt: null }),
  ]
  const results = await Promise.all(checks.map((check) => Promise.resolve(check)))
  if (!results.some(Boolean)) return false

  await markUserActivated(Models, userId)
  return true
}

export async function getPostAuthRedirectPath(userDoc, Models, preferredPath = '/') {
  if (shouldRedirectToEmailVerify(userDoc)) {
    return '/email-verify'
  }

  const claimPath = await ownClaimRedirectPath(Models, userDoc && userDoc._id)
  if (claimPath) return claimPath

  const urlDemoPath = await urlDemoRedirectPath(Models, userDoc)
  if (urlDemoPath) return urlDemoPath

  if (!(await isUserActivated(Models, userDoc))) return '/onboarding'
  return preferredPath || '/'
}
