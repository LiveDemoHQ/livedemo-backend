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

export function shouldRedirectToEmailVerify(userDoc) {
  return userDoc?.emailVerified !== true
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

async function hasClaimedContent(Models, userId) {
  if (!Models || !userId) return false
  if (Models.OwnClaim && await Models.OwnClaim.exists({ userId, status: 'completed' })) return true
  if (Models.UrlDemo && await Models.UrlDemo.exists({ userId, type: 'owned', status: 'completed' })) return true
  return false
}

export async function getPostAuthRedirectPath(userDoc, Models, preferredPath = '/') {
  if (shouldRedirectToEmailVerify(userDoc)) {
    return '/email-verify'
  }

  const claimPath = await ownClaimRedirectPath(Models, userDoc && userDoc._id)
  if (claimPath) return claimPath

  const urlDemoPath = await urlDemoRedirectPath(Models, userDoc)
  if (urlDemoPath) return urlDemoPath

  if (shouldRedirectToOnboarding(userDoc)) {
    // Already got a demo into this account — skip the goals wizard
    if (await hasClaimedContent(Models, userDoc && userDoc._id)) return preferredPath || '/'
    return '/onboarding'
  }
  return preferredPath || '/'
}
