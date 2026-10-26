import Stripe from 'stripe'
import ENV from '../envServer.js'

import logger from './logger.js'

export const FOUNDING_PROMO_CODE = 'FOUNDING50'
export const FOUNDING_PROMO_MAX_DEFAULT = 5

let stripe = null
let memoryCache = null

function getStripe() {

  if (stripe) return stripe
  if (!ENV.STRIPE_SECRET_KEY) return null
  stripe = new Stripe(ENV.STRIPE_SECRET_KEY)
  return stripe
}

function toPayload(redeemed, max, source) {

  const safeMax = Math.max(1, max || FOUNDING_PROMO_MAX_DEFAULT)
  const safeRedeemed = Math.max(0, redeemed || 0)
  const remaining = Math.max(0, safeMax - safeRedeemed)
  return {
    code: FOUNDING_PROMO_CODE,
    redeemed: safeRedeemed,
    max: safeMax,
    remaining,
    source
  }
}

async function readMongo(Models) {

  const doc = await Models.Config.findOne({}).lean()
  if (!doc || doc.foundingPromoRedeemed == null) return null
  return toPayload(
    doc.foundingPromoRedeemed,
    doc.foundingPromoMax || FOUNDING_PROMO_MAX_DEFAULT,
    'mongo'
  )
}

async function writeMongo(Models, payload) {

  await Models.Config.findOneAndUpdate(
    {},
    {
      $set: {
        foundingPromoCode: FOUNDING_PROMO_CODE,
        foundingPromoRedeemed: payload.redeemed,
        foundingPromoMax: payload.max,
        foundingPromoSyncedAt: new Date()
      }
    },
    { upsert: true }
  )
}

async function fetchFromStripe() {

  const stripeInstance = getStripe()
  if (!stripeInstance) return null

  const list = await stripeInstance.promotionCodes.list({
    code: FOUNDING_PROMO_CODE,
    limit: 1
  })
  const promo = list.data && list.data[0]
  if (!promo) return null

  return toPayload(
    promo.times_redeemed || 0,
    promo.max_redemptions || FOUNDING_PROMO_MAX_DEFAULT,
    'stripe'
  )
}

/** Live Stripe count when possible; Mongo fallback; 15s memory cache. */
export async function getFoundingPromoStatus(Models) {

  const now = Date.now()
  if (memoryCache && now - memoryCache.at < 15000) {

    return memoryCache.payload
  }

  try {

    const fromStripe = await fetchFromStripe()
    if (fromStripe) {

      await writeMongo(Models, fromStripe).catch(() => {})
      memoryCache = { at: now, payload: fromStripe }
      return fromStripe
    }
  } catch (err) {

    logger.error('[foundingPromo] Stripe lookup failed:', { eventName: 'STRIPE_LOOKUP_FAILED', data: { detail: err && err.message } })
  }

  const fromMongo = await readMongo(Models)
  if (fromMongo) {

    memoryCache = { at: now, payload: fromMongo }
    return fromMongo
  }

  const fallback = toPayload(0, FOUNDING_PROMO_MAX_DEFAULT, 'default')
  memoryCache = { at: now, payload: fallback }
  return fallback
}

export function __resetFoundingPromoCacheForTests() {

  memoryCache = null
  stripe = null
}
