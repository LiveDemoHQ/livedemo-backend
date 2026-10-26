import Stripe from 'stripe'
import ResponseCodes from '../constants/ResponseCodes.js'
import ENV from '../envServer.js'
import { syncUserStripeCustomerId } from '../helpers/paymentHelpers.js'
import SubscriptionTypes from '../constants/SubscriptionTypes.js'
import SubscriptionTypesExpireDates from '../constants/SubscriptionTypesExpireDates.js'
import { setActiveUserSubscription, enablePaidPlanUserFeatureFlags, avatarLimitsFor } from '../helpers/subscriptionHelpers.js'

import logger from '../helpers/logger.js'

const PRODUCT_TO_SUBSCRIPTION_TYPE = {
  'prod_UXbDm4HqbawhNo': SubscriptionTypes.PRO_MONTHLY,
  'prod_UXbDRK1gGrfWEh': SubscriptionTypes.PRO_ANNUALLY,
  'prod_UXbECZgFqrpCzI': SubscriptionTypes.GROWTH_MONTHLY,
  'prod_UXbEreuawwjJ1v': SubscriptionTypes.GROWTH_ANNUALLY,
  // dev products
  'prod_UXZkkwn0B77gSJ': SubscriptionTypes.PRO_MONTHLY,
  'prod_UXZmCUin8ZKi0o': SubscriptionTypes.PRO_ANNUALLY,
  'prod_UXZluZhDivdyOl': SubscriptionTypes.GROWTH_MONTHLY,
  'prod_UXZnkXaY05BRmV': SubscriptionTypes.GROWTH_ANNUALLY,
}

let stripe = null

function getStripe() {
  if (stripe) return stripe
  if (!ENV.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY not configured in environment variables')
  }
  stripe = new Stripe(ENV.STRIPE_SECRET_KEY)
  return stripe
}

const CORS_HEADERS = {
  'Access-Control-Max-Age': 600,
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
  'Access-Control-Allow-Credentials': true,
}

async function handleSubscriptionCreated(stripeSubscription, Models) {
  const stripeSubscriptionId =
    typeof stripeSubscription === 'string' ? stripeSubscription : stripeSubscription.id
  const stripeCustomerId =
    typeof stripeSubscription.customer === 'string'
      ? stripeSubscription.customer
      : stripeSubscription.customer?.id

  logger.info(`[webhook] subscription.created — stripeSubscriptionId=${stripeSubscriptionId} stripeCustomerId=${stripeCustomerId} status=${stripeSubscription.status}`, { eventName: 'POST_PAYMENTS_WEBHOOK' })

  if (!stripeCustomerId) {
    logger.error(`[webhook] subscription.created — no customer on subscription, skipping`, { eventName: 'POST_PAYMENTS_WEBHOOK_FAILED' })
    return
  }

  const user = await Models.User.findOne({ stripeCustomerId }).lean()
  if (!user) {
    logger.error(`[webhook] subscription.created — no user found for stripeCustomerId=${stripeCustomerId}, skipping`, { eventName: 'POST_PAYMENTS_WEBHOOK_FAILED' })
    return
  }

  logger.info(`[webhook] subscription.created — found user _id=${user._id}, syncing stripeCustomerId`, { eventName: 'POST_PAYMENTS_WEBHOOK' })
  await syncUserStripeCustomerId(user._id, stripeCustomerId, Models)

  // If a SubscriptionCustomer exists for this user but lacks a stripeSubscriptionId, link it
  const subscriptionCustomer = await Models.SubscriptionCustomer.findOne({
    userId: user._id,
    $or: [{ stripeSubscriptionId: null }, { stripeSubscriptionId: '' }, { stripeSubscriptionId: { $exists: false } }],
  }).lean()

  if (subscriptionCustomer) {
    logger.info(`[webhook] subscription.created — linking stripeSubscriptionId to SubscriptionCustomer _id=${subscriptionCustomer._id}`, { eventName: 'POST_PAYMENTS_WEBHOOK' })
    await Models.SubscriptionCustomer.findOneAndUpdate(
      { _id: subscriptionCustomer._id },
      { $set: { stripeSubscriptionId } }
    )
  } else {
    logger.info(`[webhook] subscription.created — no unlinked SubscriptionCustomer found for user _id=${user._id}, nothing to link`, { eventName: 'POST_PAYMENTS_WEBHOOK' })
  }

  logger.info(`[webhook] subscription.created — done`, { eventName: 'POST_PAYMENTS_WEBHOOK' })
}

// Statuses where the subscription is fully active and in good standing
const ACTIVE_STATUSES = new Set(['active', 'trialing'])
// Statuses where the sub exists but payment failed — not active, not expired
const PAYMENT_ISSUE_STATUSES = new Set(['past_due', 'unpaid', 'incomplete'])

async function handleSubscriptionUpdated(stripeSubscription, Models) {
  const stripeSubscriptionId =
    typeof stripeSubscription === 'string' ? stripeSubscription : stripeSubscription.id

  const status = stripeSubscription.status
  const cancelAtPeriodEnd = stripeSubscription.cancel_at_period_end === true

  logger.info(`[webhook] subscription.updated — stripeSubscriptionId=${stripeSubscriptionId} status=${status} cancel_at_period_end=${cancelAtPeriodEnd}`, { eventName: 'POST_PAYMENTS_WEBHOOK' })

  const subscriptionCustomer = await Models.SubscriptionCustomer.findOne({
    stripeSubscriptionId,
  }).lean()

  if (!subscriptionCustomer) {
    logger.error(`[webhook] subscription.updated — no SubscriptionCustomer found for stripeSubscriptionId=${stripeSubscriptionId}, skipping`, { eventName: 'POST_PAYMENTS_WEBHOOK_FAILED' })
    return
  }

  logger.info(`[webhook] subscription.updated — found SubscriptionCustomer _id=${subscriptionCustomer._id} userId=${subscriptionCustomer.userId}`, { eventName: 'POST_PAYMENTS_WEBHOOK' })

  // Detect plan change from items (upgrade / downgrade)
  const priceItem = stripeSubscription.items?.data?.[0]
  const productId =
    typeof priceItem?.price?.product === 'string'
      ? priceItem.price.product
      : priceItem?.price?.product?.id

  const newSubscriptionType = productId ? PRODUCT_TO_SUBSCRIPTION_TYPE[productId] : null

  logger.info(`[webhook] subscription.updated — productId=${productId} resolvedType=${newSubscriptionType || 'unknown'}`, { eventName: 'POST_PAYMENTS_WEBHOOK' })

  const existingSubscription = await Models.Subscription.findOne({
    subscriptionCustomerId: subscriptionCustomer._id,
  }).lean()

  if (ACTIVE_STATUSES.has(status) && !cancelAtPeriodEnd) {
    // Fully active — apply plan change if type resolved, deactivate other subs
    if (newSubscriptionType && existingSubscription?.type && newSubscriptionType !== existingSubscription.type) {
      logger.info(`[webhook] subscription.updated — plan change detected: ${existingSubscription.type} → ${newSubscriptionType}`, { eventName: 'POST_PAYMENTS_WEBHOOK' })
    }

    // Reset avatar limits only when the plan type changes, so a hand-edited
    // custom limit survives renewals and payment-status updates.
    const avatarLimits = newSubscriptionType && existingSubscription && newSubscriptionType !== existingSubscription.type
      ? avatarLimitsFor(newSubscriptionType)
      : null

    const update = {
      active: true,
      expired: false,
      cancelAtPeriodEnd: false,
      ...(newSubscriptionType && {
        type: newSubscriptionType,
        expireDate: SubscriptionTypesExpireDates[newSubscriptionType],
      }),
      ...(avatarLimits || {}),
    }

    logger.info(`[webhook] subscription.updated — applying active update`, { eventName: 'POST_PAYMENTS_WEBHOOK', data: { detail: update } })

    const updatedSub = await Models.Subscription.findOneAndUpdate(
      { subscriptionCustomerId: subscriptionCustomer._id },
      { $set: update },
      { new: true }
    )

    if (updatedSub && subscriptionCustomer.userId) {
      await setActiveUserSubscription(Models, subscriptionCustomer.userId, updatedSub._id)
      logger.info(`[webhook] subscription.updated — deactivated other subscriptions for userId=${subscriptionCustomer.userId}`, { eventName: 'POST_PAYMENTS_WEBHOOK' })
      await enablePaidPlanUserFeatureFlags(Models, subscriptionCustomer.userId, updatedSub.type)
      logger.info(`[webhook] subscription.updated — feature flags ensured for userId=${subscriptionCustomer.userId}`, { eventName: 'POST_PAYMENTS_WEBHOOK' })
    }
  } else if (ACTIVE_STATUSES.has(status) && cancelAtPeriodEnd) {
    // Still running but scheduled to cancel at period end
    const update = { active: true, expired: false, cancelAtPeriodEnd: true }
    logger.info(`[webhook] subscription.updated — applying cancel-at-period-end update`, { eventName: 'POST_PAYMENTS_WEBHOOK', data: { detail: update } })
    await Models.Subscription.findOneAndUpdate(
      { subscriptionCustomerId: subscriptionCustomer._id },
      { $set: update }
    )
  } else if (PAYMENT_ISSUE_STATUSES.has(status)) {
    // Payment failed — mark inactive but not expired (recoverable)
    const update = { active: false, expired: false, cancelAtPeriodEnd: false }
    logger.info(`[webhook] subscription.updated — payment issue status=${status}, disabling subscription`, { eventName: 'POST_PAYMENTS_WEBHOOK', data: { detail: update } })
    await Models.Subscription.findOneAndUpdate(
      { subscriptionCustomerId: subscriptionCustomer._id },
      { $set: update }
    )
  } else {
    // status === 'canceled' or 'incomplete_expired' — fully inactive
    const update = { active: false, expired: true, cancelAtPeriodEnd: false }
    logger.info(`[webhook] subscription.updated — terminal status=${status}, expiring subscription`, { eventName: 'POST_PAYMENTS_WEBHOOK', data: { detail: update } })
    await Models.Subscription.findOneAndUpdate(
      { subscriptionCustomerId: subscriptionCustomer._id },
      { $set: update }
    )
  }

  logger.info(`[webhook] subscription.updated — done`, { eventName: 'POST_PAYMENTS_WEBHOOK' })
}

async function handleSubscriptionDeleted(stripeSubscription, Models) {
  const stripeSubscriptionId =
    typeof stripeSubscription === 'string' ? stripeSubscription : stripeSubscription.id

  logger.info(`[webhook] subscription.deleted — stripeSubscriptionId=${stripeSubscriptionId}`, { eventName: 'POST_PAYMENTS_WEBHOOK' })

  const subscriptionCustomer = await Models.SubscriptionCustomer.findOne({
    stripeSubscriptionId,
  }).lean()

  if (!subscriptionCustomer) {
    logger.error(`[webhook] subscription.deleted — no SubscriptionCustomer found for stripeSubscriptionId=${stripeSubscriptionId}, skipping`, { eventName: 'POST_PAYMENTS_WEBHOOK_FAILED' })
    return
  }

  logger.info(`[webhook] subscription.deleted — found SubscriptionCustomer _id=${subscriptionCustomer._id}, marking expired`, { eventName: 'POST_PAYMENTS_WEBHOOK' })

  await Models.Subscription.findOneAndUpdate(
    { subscriptionCustomerId: subscriptionCustomer._id },
    { $set: { active: false, expired: true, cancelAtPeriodEnd: false } }
  )

  logger.info(`[webhook] subscription.deleted — done`, { eventName: 'POST_PAYMENTS_WEBHOOK' })
}

async function handleInvoicePaid(invoice, Models) {
  logger.info(`[webhook] invoice.paid — invoiceId=${invoice.id} customer=${invoice.customer} amount_paid=${invoice.amount_paid}`, { eventName: 'POST_PAYMENTS_WEBHOOK' })

  if (!invoice.customer) {
    logger.error(`[webhook] invoice.paid — no customer on invoice, skipping`, { eventName: 'POST_PAYMENTS_WEBHOOK_FAILED' })
    return
  }

  const stripeCustomerId =
    typeof invoice.customer === 'string' ? invoice.customer : invoice.customer.id

  const user = await Models.User.findOne({ stripeCustomerId }).lean()
  if (!user) {
    logger.error(`[webhook] invoice.paid — no user found for stripeCustomerId=${stripeCustomerId}, skipping`, { eventName: 'POST_PAYMENTS_WEBHOOK_FAILED' })
    return
  }

  logger.info(`[webhook] invoice.paid — found user _id=${user._id}, syncing stripeCustomerId`, { eventName: 'POST_PAYMENTS_WEBHOOK' })

  await syncUserStripeCustomerId(user._id, stripeCustomerId, Models)

  logger.info(`[webhook] invoice.paid — done`, { eventName: 'POST_PAYMENTS_WEBHOOK' })
}

async function handleCustomerUpdated(customer, Models) {
  const stripeCustomerId =
    typeof customer === 'string' ? customer : customer.id

  logger.info(`[webhook] customer.updated — stripeCustomerId=${stripeCustomerId}`, { eventName: 'POST_PAYMENTS_WEBHOOK' })

  if (!stripeCustomerId) {
    logger.error(`[webhook] customer.updated — no stripeCustomerId, skipping`, { eventName: 'POST_PAYMENTS_WEBHOOK_FAILED' })
    return
  }

  await syncUserStripeCustomerId(null, stripeCustomerId, Models)

  logger.info(`[webhook] customer.updated — done`, { eventName: 'POST_PAYMENTS_WEBHOOK' })
}

const handler = async function (req, res) {
  res.set(CORS_HEADERS)
  const { Models } = req.mongo

  const sig = req.headers['stripe-signature']
  const webhookSecret = ENV.STRIPE_WEBHOOK_SECRET

  logger.info(`[webhook] incoming request — sig=${sig ? 'present' : 'missing'} webhookSecret=${webhookSecret ? 'set' : 'NOT SET'}`, { eventName: 'POST_PAYMENTS_WEBHOOK' })

  let event

  try {
    const stripeInstance = getStripe()

    if (webhookSecret && sig) {
      const rawBody = req.body
      event = stripeInstance.webhooks.constructEvent(rawBody, sig, webhookSecret)
      logger.info(`[webhook] signature verified — eventId=${event.id} type=${event.type}`, { eventName: 'POST_PAYMENTS_WEBHOOK' })
    } else {
      const payload =
        Buffer.isBuffer(req.body) || typeof req.body === 'string'
          ? JSON.parse(req.body.toString())
          : req.body
      event = payload
      logger.error(`[webhook] STRIPE_WEBHOOK_SECRET not set — skipping signature verification, type=${event.type}`, { eventName: 'POST_PAYMENTS_WEBHOOK_FAILED' })
    }
  } catch (err) {
    logger.error(`[webhook] signature verification failed — ${err.message}`, { eventName: 'POST_PAYMENTS_WEBHOOK_FAILED' })
    return res.status(ResponseCodes['400_BAD_REQUEST']).json({
      error: true,
      message: `Webhook Error: ${err.message}`,
    })
  }

  logger.info(`[webhook] processing event type=${event.type} id=${event.id}`, { eventName: 'POST_PAYMENTS_WEBHOOK' })

  try {
    switch (event.type) {
      case 'customer.subscription.created': {
        await handleSubscriptionCreated(event.data.object, Models)
        break
      }
      case 'customer.subscription.updated': {
        await handleSubscriptionUpdated(event.data.object, Models)
        break
      }
      case 'customer.subscription.deleted': {
        await handleSubscriptionDeleted(event.data.object, Models)
        break
      }
      case 'invoice.paid': {
        await handleInvoicePaid(event.data.object, Models)
        break
      }
      case 'customer.updated': {
        await handleCustomerUpdated(event.data.object, Models)
        break
      }
      case 'payment_method.attached':
        logger.info(`[webhook] payment_method.attached — paymentMethodId=${event.data.object.id} customer=${event.data.object.customer}`, { eventName: 'POST_PAYMENTS_WEBHOOK' })
        break
      case 'payment_method.detached':
        logger.info(`[webhook] payment_method.detached — paymentMethodId=${event.data.object.id}`, { eventName: 'POST_PAYMENTS_WEBHOOK' })
        break
      case 'billing_portal.session.created':
        logger.info(`[webhook] billing_portal.session.created — customer=${event.data.object.customer}`, { eventName: 'POST_PAYMENTS_WEBHOOK' })
        break
      default:
        logger.info(`[webhook] unhandled event type=${event.type} id=${event.id}`, { eventName: 'POST_PAYMENTS_WEBHOOK' })
    }

    logger.info(`[webhook] event processed successfully type=${event.type} id=${event.id}`, { eventName: 'POST_PAYMENTS_WEBHOOK' })
    res.status(ResponseCodes['200_OK']).json({ received: true })
  } catch (err) {
    logger.error(`[webhook] processing error type=${event.type} id=${event.id} — ${err.message}`, { eventName: 'POST_PAYMENTS_WEBHOOK_FAILED', err: err })
    res.status(ResponseCodes['500_INTERNAL_SERVER_ERROR']).json({
      error: true,
      message: err.message,
    })
  }
}

export default handler
