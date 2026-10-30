import crypto from 'crypto'
import Sequenzy from 'sequenzy'
import ENV from '../../envServer.js'

import logger from '../logger.js'

let client = null

function isEnabled() {
  return ENV.SEQUENZY_ENABLED === true && Boolean(ENV.SEQUENZY_API_KEY)
}

function getClient() {
  if (!client) {
    client = new Sequenzy({ apiKey: ENV.SEQUENZY_API_KEY })
  }
  return client
}

// Our own team's addresses never go into Sequenzy (test accounts, staff signups)
const EXCLUDED_DOMAIN = 'livedemo.ai'

export function isExcludedEmail(email) {
  const domain = String(email || '').trim().toLowerCase().split('@').pop()
  return domain === EXCLUDED_DOMAIN || domain.endsWith(`.${EXCLUDED_DOMAIN}`)
}

function firstNameFromUser(userDoc) {
  if (userDoc?.googleProfile?.givenName) return userDoc.googleProfile.givenName
  if (!userDoc?.name) return undefined
  const parts = String(userDoc.name).trim().split(/\s+/)
  return parts[0] || undefined
}

/**
 * Create/merge Sequenzy subscriber + auto-enroll matching sequences.
 * Never throws — signup/login must succeed even if Sequenzy is down.
 */
export async function syncSignupSubscriber(userDoc, Models, { source } = {}) {
  if (!isEnabled() || !userDoc?.email) return null
  if (isExcludedEmail(userDoc.email)) return null
  if (userDoc.emailConfig?.isSubscribed === false) return null

  const tags = ['new-signup']
  if (source) tags.push(`source:${source}`)

  const userId = String(userDoc._id)
  logger.info(`[sequenzy] creating subscriber userId=${userId} email=${userDoc.email} source=${source || 'unknown'} tags=${tags.join(',')}`, { eventName: 'SEQUENZY_CLIENT' })

  try {
    const response = await getClient().subscribers.create({
      email: userDoc.email,
      externalId: userId,
      firstName: firstNameFromUser(userDoc),
      tags,
      customAttributes: {
        userId,
        signupAt: userDoc.createdAt
          ? new Date(userDoc.createdAt).toISOString()
          : new Date().toISOString(),
        emailVerified: true,
      },
      optInMode: 'confirmed',
      enrollInSequences: true,
      // SDK default (omit) = ALL company lists; sequences-only signup should not dump into every list.
      lists: [],
      duplicateStrategy: 'merge',
    })

    const subscriberId = response?.subscriber?.id || ''
    const created = response?.subscriber?.created
    const updated = response?.subscriber?.updated
    const skipped = response?.subscriber?.skipped
    logger.info(`[sequenzy] subscriber sync ok userId=${userId} subscriberId=${subscriberId} created=${!!created} updated=${!!updated} skipped=${!!skipped}`, { eventName: 'SEQUENZY_CLIENT' })

    if (Models?.User && userDoc._id) {
      await Models.User.findOneAndUpdate(
        { _id: userDoc._id },
        {
          $set: {
            'sequenzy.subscriberId': subscriberId,
            'sequenzy.syncedAt': new Date(),
            'sequenzy.lastSyncError': null,
            // e.g. unsubscribed as a migrate lead before signing up
            ...(response?.subscriber?.status === 'unsubscribed' && {
              'emailConfig.isSubscribed': false,
              'emailConfig.unsubscribedAt': new Date(),
            }),
          },
        }
      )
    }

    return response
  } catch (err) {
    logger.error('[sequenzy] syncSignupSubscriber error:', { eventName: 'SYNCSIGNUPSUBSCRIBER_ERROR', data: { detail: err?.message || err } })
    if (Models?.User && userDoc._id) {
      await Models.User.findOneAndUpdate(
        { _id: userDoc._id },
        {
          $set: {
            'sequenzy.lastSyncError': String(err?.message || err).slice(0, 500),
          },
        }
      ).catch(() => {})
    }
    return null
  }
}

/**
 * Landing-page demo migration lead (no LiveDemo account yet). Tagged so Sequenzy sequences can target it.
 * Skips emails whose LiveDemo user unsubscribed. Never throws.
 */
export async function syncMigrateLead(email, Models, { provider } = {}) {
  if (!isEnabled() || !email) return null
  if (isExcludedEmail(email)) return null
  const user = Models?.User ? await Models.User.findOne({ email }).select('emailConfig').lean().catch(() => null) : null
  if (user?.emailConfig?.isSubscribed === false) return null

  const tags = ['migrate-demo']
  if (provider) tags.push(`migrate:${provider}`)
  try {
    const response = await getClient().subscribers.create({
      email,
      tags,
      customAttributes: { migrateRequestedAt: new Date().toISOString() },
      optInMode: 'confirmed',
      enrollInSequences: true,
      lists: [],
      duplicateStrategy: 'merge',
    })
    logger.info(`[sequenzy] migrate lead ok email=${email} provider=${provider || ''} subscriberId=${response?.subscriber?.id || ''}`, { eventName: 'SEQUENZY_CLIENT' })
    return response
  } catch (err) {
    logger.error('[sequenzy] syncMigrateLead error:', { eventName: 'SYNCMIGRATELEAD_ERROR', data: { detail: err?.message || err } })
    return null
  }
}

/** LiveDemo unsubscribe → Sequenzy. Cancels sequence enrollments. Never throws. */
export async function unsubscribeSubscriber(userDoc) {
  if (!isEnabled() || !userDoc?.email) return
  try {
    await getClient().subscribers.update(userDoc.email, { status: 'unsubscribed' })
  } catch (err) {
    logger.error('[sequenzy] unsubscribeSubscriber error:', { eventName: 'UNSUBSCRIBESUBSCRIBER_ERROR', data: { detail: err?.message || err } })
  }
}

/** Verify X-Sequenzy-Signature: HMAC-SHA256 of `v1:{timestamp}:{rawBody}`. */
export function verifyWebhookSignature(rawBody, timestamp, signatureHeader, secret = ENV.SEQUENZY_WEBHOOK_SECRET) {
  if (!secret || !timestamp || !signatureHeader) return false

  const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`v1:${timestamp}:${payload}`)
    .digest('hex')

  const candidates = String(signatureHeader)
    .split(',')
    .map((part) => part.trim())
    .map((part) => (part.startsWith('v1=') ? part.slice(3) : part))
    .filter(Boolean)

  const expectedBuf = Buffer.from(expected, 'utf8')
  return candidates.some((candidate) => {
    const candidateBuf = Buffer.from(candidate, 'utf8')
    if (candidateBuf.length !== expectedBuf.length) return false
    return crypto.timingSafeEqual(expectedBuf, candidateBuf)
  })
}

export function isSequenzyEnabled() {
  return isEnabled()
}
