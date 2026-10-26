// NOTE: This handler requires Stripe integration
// Install stripe package: npm install stripe
// Configure STRIPE_SECRET_KEY in envServer.js

import ResponseCodes from '../constants/ResponseCodes.js'
import postChargeInternalValidator from '../helpers/validators/oldLambdaRoutes/payments/postChargeInternalValidator.js'
import SubscriptionTypes from '../constants/SubscriptionTypes.js'
import SubscriptionPrices from '../constants/SubscriptionPrices.js'
import SubscriptionTypesExpireDates from '../constants/SubscriptionTypesExpireDates.js'
import SubscriptionTypesMembersAllowed from '../constants/SubscriptionTypesMembersAllowed.js'
import ChargeStatuses from '../constants/ChargeStatuses.js'
import WorkspaceTypes from '../constants/WorkspaceTypes.js'
import ENV from '../envServer.js'
import { mapCard } from '../helpers/mapper.js'
import helpers from '../helpers/livedemoHelpers.js'

import logger from '../helpers/logger.js'

// Uncomment when Stripe is configured:
// import Stripe from 'stripe'
// const stripe = Stripe(ENV.STRIPE_SECRET_KEY)

const fromDollarToCent = (amount) => Math.round(Number(amount * 100))

const handler = function (req, res) {
  let { Models, conn } = req.mongo
  let requestBody = req.body

  return Promise.resolve().then(() => {
      // Validate request body
      let validatedBody = helpers.validateBody(requestBody, postChargeInternalValidator)
      if (validatedBody.error) {
        throw new Error(validatedBody.error.message || 'Validation failed')
      }
      requestBody = validatedBody.value
    })
    .then(() => {
      const userId = requestBody.userId
      const useSavedCard = requestBody.useSavedCard
      const autoPay = requestBody.autoPay
      const cardId = requestBody.cardId
      const paymentMethod = requestBody.paymentMethod
      const subscriptionType = requestBody.subscriptionType.toUpperCase()
      const currency = requestBody.currency
      const workspaceId = requestBody.workspaceId

      if (!SubscriptionTypes[subscriptionType] ||
        (useSavedCard === false && (!paymentMethod || !paymentMethod.id)) ||
        (useSavedCard === true && (!cardId || cardId === ''))) {
        throw new Error('Incorrect SubscriptionType or payment method')
      }

      const amount = SubscriptionPrices[subscriptionType]
      if (!amount) {
        throw new Error('Invalid subscription type')
      }

      // Get user data
      return Models.User.findOne({ _id: userId })
        .lean()
        .then((userData) => {
          if (!userData) {
            throw new Error('User not found')
          }

          // Verify workspace can be purchased
          return Models.Workspace.findOne({ _id: workspaceId }).lean()
            .then((workspace) => {
              if (!workspace) {
                throw new Error('Workspace not found')
              }
              // Check if workspace is already purchased (not EMPTY)
              if (workspace.type !== WorkspaceTypes.EMPTY) {
                throw new Error('Cannot pay for a Workspace which is already purchased')
              }

              return { userData, workspace, useSavedCard, autoPay, cardId, paymentMethod, subscriptionType, currency, amount }
            })
        })
    })
    .then(({ userData, workspace, useSavedCard, autoPay, cardId, paymentMethod, subscriptionType, currency, amount }) => {
      // TODO: Implement Stripe integration
      // For now, return error indicating Stripe needs to be configured
      throw new Error('Stripe integration not yet configured. Please install stripe package and configure STRIPE_SECRET_KEY in envServer.js')
      
      // When Stripe is configured, uncomment and implement:
      /*
      return createOrUpdateUserCustomerId(userData._id, Models, paymentMethod, stripe)
        .then((customerId) => {
          if (!useSavedCard) {
            return updatePaymentMethodWithCustomerId(customerId, paymentMethod, stripe)
              .then((paymentMethod) => {
                return {
                  paymentMethodId: paymentMethod.id,
                  customerId: customerId
                }
              })
          } else {
            return Models.Card.findOne({ _id: cardId }).lean()
              .then(card => {
                return {
                  paymentMethodId: card.paymentMethodId,
                  customerId: customerId
                }
              })
          }
        })
        .then(({ paymentMethodId, customerId }) => {
          return stripe.paymentIntents.create({
            amount: fromDollarToCent(amount),
            currency: currency,
            payment_method: paymentMethodId,
            statement_descriptor: 'LiveDemo - Purchase',
            customer: customerId,
            off_session: false,
            confirm: true,
            return_url: `${ENV.SERVER_URL}/add-workspace/finalize-3ds`
          })
        })
        .then((confirmedPaymentIntent) => {
          const requires3dSecure = checkIntentIfIs3dSecure(confirmedPaymentIntent)

          // Get or create card
          let cardPromise
          if (!useSavedCard) {
            cardPromise = createCard(userData._id, paymentMethod, Models)
          } else {
            cardPromise = Models.Card.findOne({ _id: cardId }).lean()
          }

          return cardPromise.then((card) => {
            if (!requires3dSecure) {
              // Create subscription and charge immediately
              return createSubscriptionAndCharge(workspace, userData, subscriptionType, autoPay, confirmedPaymentIntent, card, useSavedCard, currency, amount, Models)
                .then(({ subscription, charge, requires3dSecure, ThreeDSecureIframeUrl }) => {
                  // Trigger afterPayment
                  return triggerAfterPayment(charge._id, subscription._id, Models, conn)
                    .then(() => {
                      return { charge, requires3dSecure, ThreeDSecureIframeUrl }
                    })
                })
            } else {
              // Create pending charge for 3D Secure
              return createPendingCharge(workspace, userData, subscriptionType, autoPay, confirmedPaymentIntent, card, useSavedCard, currency, amount, Models)
                .then((charge) => {
                  return {
                    charge,
                    requires3dSecure: true,
                    ThreeDSecureIframeUrl: confirmedPaymentIntent.next_action.redirect_to_url.url
                  }
                })
            }
          })
        })
      */
    })
    .then(({ charge, requires3dSecure, ThreeDSecureIframeUrl }) => {
      const resultResponse = {
        statusCode: ResponseCodes['200_OK'],
        headers: {
          'Access-Control-Max-Age': 600,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
          'Access-Control-Allow-Credentials': true,
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(JSON.stringify({
        message: requires3dSecure ? 'Payment requires additional verification' : 'Charge processed successfully!',
        '3dSecure': requires3dSecure,
        '3dSecureUrl': ThreeDSecureIframeUrl || '',
        error: false,
        charge: charge,
      }))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_PAYMENT_CHARGE_INTERNAL_FAILED' })

      const resultResponse = {
        statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
        headers: {
          'Access-Control-Max-Age': 600,
          'Access-Control-Allow-Credentials': true,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
        },
        body: JSON.stringify({
          message: 'Something wrong happened',
          '3dSecure': false,
          '3dSecureUrl': '',
          error: true,
          errorMessage: error.message,
        })
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

// Helper functions (to be implemented when Stripe is configured)
function checkIntentIfIs3dSecure(paymentIntent) {
  if (paymentIntent.status === 'requires_action' &&
    paymentIntent.next_action &&
    paymentIntent.next_action.redirect_to_url &&
    paymentIntent.next_action.redirect_to_url.url) {
    return true
  }
  return false
}

function createCard(userId, paymentMethod, Models) {
  const mappedCard = mapCard(paymentMethod.card)
  return new Models.Card({
    ...mappedCard,
    userId: userId,
    paymentMethodId: paymentMethod.id
  }).save()
    .then((card) => {
      return Models.User.findOneAndUpdate(
        { _id: userId },
        {
          $set: { defaultCardId: card.id },
          $push: { cards: card.id }
        }
      )
        .then(() => card)
    })
}

async function triggerAfterPayment(chargeId, subscriptionId, Models, conn) {
  // Directly call the afterPayment handler function
  // This replaces the Lambda invocation
  const afterPaymentHandler = (await import('./postPaymentAfterPayment.js')).default
  
  // Create a mock request/response object
  const mockReq = {
    mongo: { Models, conn },
    body: {
      chargeId: chargeId.toString(),
      subscriptionId: subscriptionId.toString()
    }
  }
  
  const mockRes = {
    set: () => mockRes,
    status: () => mockRes,
    send: () => {}
  }

  // Call the handler directly
  return afterPaymentHandler(mockReq, mockRes)
    .catch((err) => {
      logger.error('Error in afterPayment handler:', { eventName: 'ERROR_IN_AFTERPAYMENT_HANDLER_FAILED', err: err })
      // Don't throw - allow the charge to complete even if afterPayment fails
      return Promise.resolve()
    })
}

export default handler
