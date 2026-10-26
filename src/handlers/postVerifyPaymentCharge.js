// NOTE: This handler requires Stripe integration
// Install stripe package: npm install stripe
// Configure STRIPE_SECRET_KEY in envServer.js

import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import ChargeStatuses from '../constants/ChargeStatuses.js'
import SubscriptionTypes from '../constants/SubscriptionTypes.js'
import SubscriptionTypesExpireDates from '../constants/SubscriptionTypesExpireDates.js'
import SubscriptionTypesMembersAllowed from '../constants/SubscriptionTypesMembersAllowed.js'
import SubscriptionTypesRank from '../constants/SubscriptionTypesRank.js'
import EventReporter from '../helpers/eventReporter.js'
import EventNamesEnum from '../constants/EventNamesEnum.js'
import ENV from '../envServer.js'
import { mapCard } from '../helpers/mapper.js'

import logger from '../helpers/logger.js'

// Uncomment when Stripe is configured:
// import Stripe from 'stripe'
// const stripe = Stripe(ENV.STRIPE_SECRET_KEY)

const handler = function (req, res) {
  let { Models, conn } = req.mongo
  let authUserDoc = null
  let requestBody = req.body

  return Promise.resolve().then(async () => {
      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser

      // Get charge ID from request body
      const chargeId = requestBody.id
      if (!chargeId) {
        throw new Error('Charge ID is required')
      }

      return chargeId
    })
    .then((chargeId) => {
      // Find charge
      return Models.Charge.findOne({ _id: chargeId }).lean()
        .then((charge) => {
          if (!charge) {
            throw new Error('No Charge Found')
          }

          if (charge.status !== ChargeStatuses.PENDING) {
            throw new Error('Charge already verified')
          }

          return { charge, chargeId }
        })
    })
    .then(({ charge, chargeId }) => {
      // TODO: Implement Stripe payment intent retrieval
      // For now, return error indicating Stripe needs to be configured
      throw new Error('Stripe integration not yet configured. Please install stripe package and configure STRIPE_SECRET_KEY in envServer.js')
      
      // When Stripe is configured, uncomment and implement:
      /*
      const paymentIntentId = charge.paymentIntentId

      return stripe.paymentIntents.retrieve(paymentIntentId)
        .then((paymentIntent) => {
          return { charge, paymentIntent, chargeId }
        })
      */
    })
    .then(({ charge, paymentIntent, chargeId }) => {
      // TODO: Handle payment intent status
      // When Stripe is configured, implement:
      /*
      if (paymentIntent.status === 'succeeded') {
        // Create subscription
        return new Models.Subscription({
          type: charge.subscriptionType,
          membersAllowed: SubscriptionTypesMembersAllowed[charge.subscriptionType],
          workspaceIds: [charge.workspaceId],
          chargeId: charge._id,
          userId: authUserDoc._id,
          active: true,
          autoPay: charge.autoPay,
          expireDate: SubscriptionTypesExpireDates[charge.subscriptionType.toLowerCase()]
        }).save()
          .then((subscription) => {
            return Models.Workspace.findOneAndUpdate(
              { _id: charge.workspaceId },
              { $push: { subscriptions: subscription._id } }
            )
              .then(() => {
                return Models.User.findOneAndUpdate(
                  { _id: charge.userId },
                  { $push: { subscriptions: subscription._id } }
                )
                  .then(() => {
                    return { subscription, charge, chargeId }
                  })
              })
          })
          .then(({ subscription, charge, chargeId }) => {
            // Handle card creation/retrieval
            if (charge.useSavedCard) {
              return Models.Card.findOne({ paymentMethodId: charge.paymentMethodId }).lean()
                .then((card) => {
                  return Models.User.findOneAndUpdate(
                    { _id: authUserDoc._id },
                    { $set: { defaultCardId: card._id } }
                  )
                    .then(() => {
                      return { subscription, charge, chargeId, card }
                    })
                })
            } else {
              return stripe.paymentMethods.retrieve(charge.paymentMethodId)
                .then((paymentMethod) => {
                  const mappedCard = mapCard(paymentMethod.card)
                  return new Models.Card({
                    ...mappedCard,
                    userId: authUserDoc._id,
                    paymentMethodId: charge.paymentMethodId,
                  }).save()
                })
                .then((card) => {
                  return Models.User.findOneAndUpdate(
                    { _id: authUserDoc._id },
                    {
                      $set: { defaultCardId: card.id },
                      $push: { cards: card.id }
                    }
                  )
                    .then(() => {
                      return { subscription, charge, chargeId, card }
                    })
                })
            }
          })
          .then(({ subscription, charge, chargeId, card }) => {
            // Update charge
            return Models.Charge.findOneAndUpdate(
              { _id: chargeId },
              {
                $set: {
                  cardId: card._id,
                  subscriptionId: subscription._id,
                  status: ChargeStatuses.COMPLETED
                }
              },
              { new: true }
            )
              .then((chargeDoc) => {
                // Update workspace type
                return Models.Workspace.findOneAndUpdate(
                  { _id: { $in: subscription.workspaceIds } },
                  { $set: { type: subscription.type } }
                )
                  .then(() => {
                    return EventReporter.storeInfoEvent(EventNamesEnum.SUBSCRIPITON_PURCHASED, {
                      userId: authUserDoc._id,
                      chargeDoc,
                      subscription
                    })
                      .then(() => {
                        return { chargeDoc }
                      })
                  })
              })
          })
      } else if (paymentIntent.status === 'requires_action') {
        throw new Error('3D Secure verification failed')
      } else {
        throw new Error('Something went wrong')
      }
      */
    })
    .then(() => {
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
        message: 'Charge processed successfully!',
        error: false,
      }))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_VERIFY_PAYMENT_CHARGE_FAILED' })

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
          error: true,
          errorMessage: error.message,
        })
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default handler
