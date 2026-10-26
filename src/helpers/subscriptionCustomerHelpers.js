import Stripe from 'stripe'
import ENV from '../envServer.js'

import logger from './logger.js'

let stripe = null

function getStripe() {
  if (stripe) return stripe
  if (!ENV.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY not configured')
  }
  stripe = new Stripe(ENV.STRIPE_SECRET_KEY)
  return stripe
}

/**
 * Enable or disable automatic renewal / collection on the Stripe subscription.
 * autoPay true  -> renew at period end (cancel_at_period_end: false, resume collection)
 * autoPay false -> stop renewing (cancel_at_period_end: true)
 */
export async function syncStripeSubscriptionAutoPay(stripeSubscriptionId, autoPay) {
  if (!stripeSubscriptionId) {
    throw new Error('No Stripe subscription linked to this billing profile')
  }

  const stripeInstance = getStripe()

  if (autoPay) {
    await stripeInstance.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: false,
    })

    try {
      await stripeInstance.subscriptions.update(stripeSubscriptionId, {
        pause_collection: null,
      })
    } catch (err) {
      // Ignore when collection was not paused
      if (err?.code !== 'resource_missing' && err?.param !== 'pause_collection') {
        logger.error('syncStripeSubscriptionAutoPay resume:', { eventName: 'SYNCSTRIPESUBSCRIPTIONAUTOPAY_RESUME_FAILED', err: err.message })
      }
    }
  } else {
    await stripeInstance.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: true,
    })
  }

  const customerId = (await stripeInstance.subscriptions.retrieve(stripeSubscriptionId)).customer
  if (customerId) {
    await stripeInstance.customers.update(
      typeof customerId === 'string' ? customerId : customerId.id,
      { metadata: { autoPay: autoPay ? 'true' : 'false' } }
    )
  }
}

export async function getOrCreateSubscriptionCustomer(
  Models,
  userId,
  {
    cardId,
    autoPay = true,
    stripeCustomerId,
    stripeSubscriptionId,
  } = {}
) {
  return upsertSubscriptionCustomer(Models, {
    userId,
    cardId,
    autoPay,
    stripeCustomerId,
    stripeSubscriptionId,
  })
}

/** Link a subscription to its billing profile (both sides of the relation). */
export async function linkSubscriptionToCustomer(
  Models,
  subscriptionId,
  subscriptionCustomerId
) {
  if (!subscriptionId || !subscriptionCustomerId) return

  await Models.Subscription.findOneAndUpdate(
    { _id: subscriptionId },
    { $set: { subscriptionCustomerId } }
  )

  await Models.SubscriptionCustomer.findOneAndUpdate(
    { _id: subscriptionCustomerId },
    { $addToSet: { subscriptions: subscriptionId } }
  )
}

export async function upsertSubscriptionCustomer(
  Models,
  {
    userId,
    cardId,
    chargeId,
    subscriptionId,
    autoPay = true,
    stripeCustomerId,
    stripeSubscriptionId,
  }
) {
  const update = {
    $set: {
      autoPay,
    },
    $setOnInsert: {
      userId,
    },
  }

  if (cardId) {
    update.$set.cardId = cardId
  }

  if (stripeCustomerId) {
    update.$set.stripeCustomerId = stripeCustomerId
  }

  if (stripeSubscriptionId) {
    update.$set.stripeSubscriptionId = stripeSubscriptionId
  }

  if (chargeId || subscriptionId) {
    update.$addToSet = {}
    if (chargeId) {
      update.$addToSet.charges = chargeId
    }
    if (subscriptionId) {
      update.$addToSet.subscriptions = subscriptionId
    }
  }

  return Models.SubscriptionCustomer.findOneAndUpdate(
    { userId },
    update,
    { upsert: true, new: true }
  ).lean()
}

export function normalizeSubscriptionCustomer(doc) {
  if (!doc) return doc
  return typeof doc.toObject === 'function' ? doc.toObject() : { ...doc }
}
