// NOTE: This handler requires Stripe integration
// Install stripe package: npm install stripe
// Configure STRIPE_SECRET_KEY in envServer.js

import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import postChargeValidator from '../helpers/validators/oldLambdaRoutes/payments/postChargeValidator.js'
import SubscriptionTypes from '../constants/SubscriptionTypes.js'
import SubscriptionPrices from '../constants/SubscriptionPrices.js'
import SubscriptionTypesExpireDates from '../constants/SubscriptionTypesExpireDates.js'
import SubscriptionTypesRank from '../constants/SubscriptionTypesRank.js'
import ChargeStatuses from '../constants/ChargeStatuses.js'
import EventReporter from '../helpers/eventReporter.js'
import EventNamesEnum from '../constants/EventNamesEnum.js'
import ENV from '../envServer.js'
import { mapCard } from '../helpers/mapper.js'
import WorkspaceTypes from '../constants/WorkspaceTypes.js'
import {
  getSubscriptionWorkspaceIds,
  setActiveUserSubscription,
  avatarLimitsFor,
} from '../helpers/subscriptionHelpers.js'
import {
  getOrCreateSubscriptionCustomer,
  linkSubscriptionToCustomer,
  upsertSubscriptionCustomer,
} from '../helpers/subscriptionCustomerHelpers.js'

// Stripe integration - will be initialized when needed
let stripe = null

const fromDollarToCent = (amount) => Math.round(Number(amount * 100))

// Initialize Stripe if available
async function getStripe() {
  if (stripe) {
    return stripe
  }
  
  if (!ENV.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY not configured in environment variables')
  }
  
  try {
    const Stripe = (await import('stripe')).default
    stripe = Stripe(ENV.STRIPE_SECRET_KEY)
    return stripe
  } catch (err) {
    throw new Error('Stripe package not installed. Install with: npm install stripe')
  }
}

const handler = function (req, res) {
  let { Models, conn } = req.mongo
  let authUserDoc = null
  let requestBody = req.body

  return Promise.resolve().then(async () => {
      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser

      // Validate request body
      let validatedBody = helpers.validateBody(requestBody, postChargeValidator)
      if (validatedBody.error) {
        const resultResponse = {
          statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
            'Access-Control-Allow-Credentials': true,
          },
          body: JSON.stringify({
            message: 'Something wrong happened',
            '3dSecure': false,
            '3dSecureUrl': '',
            error: true,
            errorMessage: 'Incorrect SubscriptionType'
          })
        }

        let error = new Error('Validation failed')
        error.resultResponse = resultResponse
        throw error
      }
      requestBody = validatedBody.value
    })
    .then(() => {
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
            errorMessage: 'Incorrect SubscriptionType'
          })
        }

        let error = new Error('Incorrect SubscriptionType')
        error.resultResponse = resultResponse
        throw error
      }

      const amount = SubscriptionPrices[subscriptionType]
      if (!amount) {
        throw new Error('Invalid subscription type')
      }

      // Verify workspace can be purchased
      return verifyWorkspaceCanBePurchased(workspaceId, subscriptionType, Models)
        .then(() => {
          return { useSavedCard, autoPay, cardId, paymentMethod, subscriptionType, currency, workspaceId, amount }
        })
    })
    .then(async ({ useSavedCard, autoPay, cardId, paymentMethod, subscriptionType, currency, workspaceId, amount }) => {
      // Initialize Stripe
      const stripeInstance = await getStripe()

      return createOrUpdateUserCustomerId(authUserDoc._id, Models, paymentMethod, stripeInstance)
        .then((customerId) => {
          if (!useSavedCard) {
            return updatePaymentMethodWithCustomerId(customerId, paymentMethod, stripeInstance)
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
          return stripeInstance.paymentIntents.create({
            amount: fromDollarToCent(amount),
            currency: currency,
            payment_method: paymentMethodId,
            statement_descriptor: 'LiveDemo - Purchase',
            customer: customerId,
            off_session: false,
            confirm: true,
            return_url: `${ENV.SERVER_URL}/billing/payment/${subscriptionType.toLowerCase()}/finalize-3ds`
          })
        })
        .then((confirmedPaymentIntent) => {
          const requires3dSecure = checkIntentIfIs3dSecure(confirmedPaymentIntent)

          // Verify workspace exists and get/create card
          return verifyWorkspaceExist(workspaceId, Models)
            .then((workspace) => {
              if (!useSavedCard) {
                return createCard(authUserDoc._id, paymentMethod, Models)
                  .then(card => {
                    return {
                      workspace,
                      card
                    }
                  })
              } else {
                return Models.Card.findOne({ _id: cardId }).lean()
                  .then((card) => {
                    return {
                      workspace,
                      card
                    }
                  })
              }
            })
            .then(({ workspace, card }) => {
              if (!requires3dSecure) {
                // Create subscription and charge immediately
                return createSubscriptionAndCharge(
                  workspace,
                  authUserDoc,
                  subscriptionType,
                  autoPay,
                  confirmedPaymentIntent,
                  card,
                  useSavedCard,
                  currency,
                  amount,
                  Models
                )
                  .then(({ subscription, charge }) => {
                    return Promise.all(
                      getSubscriptionWorkspaceIds(subscription).map((workspaceId) =>
                        setWorkspaceType(workspaceId, subscription.type, Models)
                      )
                    )
                      .then(() => {
                        return EventReporter.storeInfoEvent(EventNamesEnum.SUBSCRIPITON_PURCHASED, {
                          userId: authUserDoc._id,
                          charge,
                          subscription
                        })
                          .then(() => {
                            // Trigger afterPayment directly
                            return triggerAfterPayment(charge._id, subscription._id, Models, conn)
                              .then(() => {
                                return {
                                  charge,
                                  requires3dSecure: false,
                                  ThreeDSecureIframeUrl: ''
                                }
                              })
                          })
                      })
                  })
              } else {
                // Create pending charge for 3D Secure
                return createPendingCharge(
                  workspace,
                  authUserDoc,
                  subscriptionType,
                  autoPay,
                  confirmedPaymentIntent,
                  card,
                  useSavedCard,
                  currency,
                  amount,
                  Models
                )
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
      console.log(error)

      let resultResponse
      if (error.resultResponse) {
        resultResponse = error.resultResponse
      } else {
        resultResponse = {
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
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

// Helper functions
function checkIntentIfIs3dSecure(paymentIntent) {
  if (paymentIntent.status === 'requires_action' &&
    paymentIntent.next_action &&
    paymentIntent.next_action.redirect_to_url &&
    paymentIntent.next_action.redirect_to_url.url) {
    return true
  }
  return false
}

function verifyWorkspaceCanBePurchased(workspaceId, newSubType, Models) {
  return Models.Workspace.findOne({ _id: workspaceId }).lean()
    .then(workspace => {
      if (!workspace) {
        throw new Error('Workspace not found')
      }
      
      // Get rank for comparison
      // workspace.type is like 'startup', 'pro', 'business', or 'empty'
      // We need to map it to the subscription type format for ranking
      const workspaceTypeToSubscriptionType = {
        'empty': 'STARTUP_MONTHLY',
        'startup': 'STARTUP_MONTHLY',
        'pro': 'PRO_MONTHLY',
        'business': 'BUSINESS_MONTHLY'
      }
      
      const currentWorkspaceSubType = workspaceTypeToSubscriptionType[workspace.type] || 'STARTUP_MONTHLY'
      const currentRank = SubscriptionTypesRank[currentWorkspaceSubType] || 0
      const newRank = SubscriptionTypesRank[newSubType] || 0
      
      if (currentRank >= newRank) {
        throw new Error('Cannot pay for a Workspace which is already purchased')
      }
      return true
    })
}

function verifyWorkspaceExist(workspaceId, Models) {
  return Models.Workspace.findOne({ _id: workspaceId }).lean()
    .then(workspace => {
      if (!workspace) {
        throw new Error('Workspace not found')
      }
      return workspace
    })
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

function createOrUpdateUserCustomerId(userId, Models, paymentMethod, stripe) {
  return Models.User.findOne({ _id: userId })
    .then(userDoc => {
      if (userDoc.stripeCustomerId) {
        return Promise.resolve(userDoc.stripeCustomerId)
      } else {
        return stripe.customers.create({ name: paymentMethod.billing_details.name })
          .then(customer => {
            return Models.User.findOneAndUpdate(
              { _id: userId },
              { $set: { stripeCustomerId: customer.id } }
            )
              .then(() => customer.id)
          })
      }
    })
}

function updatePaymentMethodWithCustomerId(customerId, paymentMethod, stripe) {
  return stripe.paymentMethods.attach(
    paymentMethod.id,
    { customer: customerId }
  )
    .then((paymentMethod) => paymentMethod)
}

function setWorkspaceType(workspaceId, subscriptionType, Models) {
  // Map subscription type to workspace type
  // subscriptionType is like 'startup_monthly', 'pro_monthly', etc.
  const subscriptionToWorkspaceType = {
    'startup_monthly': WorkspaceTypes.STARTUP,
    'startup_annually': WorkspaceTypes.STARTUP,
    'pro_monthly': WorkspaceTypes.PRO,
    'pro_annually': WorkspaceTypes.PRO,
    'business_monthly': WorkspaceTypes.BUSINESS,
    'business_annually': WorkspaceTypes.BUSINESS
  }
  
  const mappedType = subscriptionToWorkspaceType[subscriptionType.toLowerCase()] || WorkspaceTypes.EMPTY
  
  return Models.Workspace.findOneAndUpdate(
    { _id: workspaceId },
    { $set: { type: mappedType } }
  )
    .then((workspace) => workspace)
}

function createSubscriptionAndCharge(workspace, authUserDoc, subscriptionType, autoPay, confirmedPaymentIntent, card, useSavedCard, currency, amount, Models) {
  return getOrCreateSubscriptionCustomer(Models, authUserDoc._id, {
    cardId: card?._id,
    autoPay,
  })
    .then((subscriptionCustomer) =>
      new Models.Subscription({
        type: SubscriptionTypes[subscriptionType],
        workspaceIds: [workspace._id],
        subscriptionCustomerId: subscriptionCustomer._id,
        active: true,
        userId: authUserDoc._id,
        autoPay: autoPay,
        expired: false,
        expireDate: SubscriptionTypesExpireDates[subscriptionType.toLowerCase()],
        ...avatarLimitsFor(SubscriptionTypes[subscriptionType]),
      })
        .save()
        .then((subscription) =>
          setActiveUserSubscription(Models, authUserDoc._id, subscription._id)
            .then(() =>
              linkSubscriptionToCustomer(
                Models,
                subscription._id,
                subscriptionCustomer._id
              )
            )
            .then(() => subscription)
        )
    )
    .then((subscription) => {
      return Models.Workspace.findOneAndUpdate(
        { _id: workspace._id },
        { $push: { subscriptions: subscription._id } }
      )
        .then(() => {
          return Models.User.findOneAndUpdate(
            { _id: subscription.userId },
            { $push: { subscriptions: subscription._id } }
          )
            .then(() => {
              return { subscription, card }
            })
        })
    })
    .then(({ subscription, card }) => {
      return new Models.Charge({
        amount: amount,
        status: ChargeStatuses.COMPLETED,
        paymentIntentId: confirmedPaymentIntent.id,
        paymentMethodId: card.paymentMethodId,
        subscriptionId: subscription._id,
        subscriptionType: SubscriptionTypes[subscriptionType],
        workspaceId: workspace._id,
        userId: authUserDoc._id,
        currency: currency,
        cardId: card._id,
        useSavedCard: useSavedCard,
        autoPay: autoPay
      }).save()
        .then((charge) => {
          return Models.Subscription.findOneAndUpdate(
            { _id: charge.subscriptionId },
            { $set: { chargeId: charge._id } }
          )
            .then(() =>
              upsertSubscriptionCustomer(Models, {
                userId: authUserDoc._id,
                chargeId: charge._id,
                subscriptionId: subscription._id,
                cardId: card?._id,
                autoPay,
              })
            )
            .then(() => ({ subscription, charge }))
        })
    })
}

function createPendingCharge(workspace, authUserDoc, subscriptionType, autoPay, confirmedPaymentIntent, card, useSavedCard, currency, amount, Models) {
  return new Models.Charge({
    amount: amount,
    status: ChargeStatuses.PENDING,
    paymentIntentId: confirmedPaymentIntent.id,
    paymentMethodId: card.paymentMethodId,
    subscriptionType: SubscriptionTypes[subscriptionType],
    workspaceId: workspace._id,
    currency: currency,
    userId: authUserDoc._id,
    useSavedCard: useSavedCard,
    autoPay: autoPay
  }).save()
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
      console.error('Error in afterPayment handler:', err)
      // Don't throw - allow the charge to complete even if afterPayment fails
      return Promise.resolve()
    })
}

export default handler
