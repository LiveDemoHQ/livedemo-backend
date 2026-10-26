// Helper function to directly call postChargeInternal handler
// This replaces Lambda invocation

import postPaymentChargeInternalHandler from '../handlers/postPaymentChargeInternal.js'
import { mapCard } from './mapper.js'

import logger from './logger.js'

/**
 * Persist a Stripe payment method as a user Card (or reuse existing).
 * @returns {Promise<object|null>} Saved card document
 */
export async function saveUserCardFromStripePaymentMethod(
  stripe,
  paymentMethodId,
  userId,
  Models
) {
  const pmId = typeof paymentMethodId === 'string'
    ? paymentMethodId
    : paymentMethodId?.id

  if (!pmId) return null

  const existingCard = await Models.Card.findOne({
    paymentMethodId: pmId,
    userId,
  }).lean()

  if (existingCard) {
    await Models.User.findOneAndUpdate(
      { _id: userId },
      { $set: { defaultCardId: existingCard._id } }
    )
    return existingCard
  }

  const paymentMethod = await stripe.paymentMethods.retrieve(pmId)
  if (!paymentMethod?.card) return null

  const card = await new Models.Card({
    ...mapCard(paymentMethod.card),
    userId,
    paymentMethodId: pmId,
  }).save()

  await Models.User.findOneAndUpdate(
    { _id: userId },
    {
      $set: { defaultCardId: card._id },
      $addToSet: { cards: card._id },
    }
  )

  return card
}

/**
 * Store Stripe customer id on the user when checkout creates one.
 */
export async function syncUserStripeCustomerId(userId, stripeCustomerId, Models) {
  const customerId = typeof stripeCustomerId === 'string'
    ? stripeCustomerId
    : stripeCustomerId?.id

  if (!customerId) return

  await Models.User.findOneAndUpdate(
    { _id: userId, stripeCustomerId: { $in: [null, ''] } },
    { $set: { stripeCustomerId: customerId } }
  )
}

/**
 * Triggers postChargeInternal handler directly (without Lambda)
 * @param {string} userId - User ID
 * @param {string} cardId - Card ID (if useSavedCard is true)
 * @param {string} currency - Currency code
 * @param {string} subscriptionType - Subscription type
 * @param {string} workspaceId - Workspace ID
 * @param {boolean} useSavedCard - Whether to use saved card
 * @param {object} Models - Mongoose models
 * @param {object} conn - MongoDB connection
 * @returns {Promise}
 */
export function triggerPostChargeInternal(userId, cardId, currency, subscriptionType, workspaceId, useSavedCard, Models, conn) {
  // Prepare request body
  const requestBody = {
    userId: userId,
    cardId: cardId,
    currency: currency,
    subscriptionType: subscriptionType,
    workspaceId: workspaceId,
    useSavedCard: useSavedCard,
    autoPay: true
  }

  // Create mock request/response objects
  const mockReq = {
    mongo: { Models, conn },
    body: requestBody
  }

  const mockRes = {
    set: () => mockRes,
    status: () => mockRes,
    send: () => {}
  }

  // Call the handler directly
  return postPaymentChargeInternalHandler(mockReq, mockRes)
    .catch((err) => {
      logger.error('Error in postChargeInternal handler:', { eventName: 'ERROR_IN_POSTCHARGEINTERNAL_HANDLER_FAILED', err: err })
      throw err
    })
}

export default {
  triggerPostChargeInternal,
  saveUserCardFromStripePaymentMethod,
  syncUserStripeCustomerId,
}
