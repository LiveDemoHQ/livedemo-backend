import Stripe from 'stripe'
import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import ENV from '../envServer.js'
import { syncUserStripeCustomerId } from '../helpers/paymentHelpers.js'

import logger from '../helpers/logger.js'

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

const handler = async function (req, res) {
  res.set(CORS_HEADERS)
  const { Models } = req.mongo

  try {
    const { authUser: authUserDoc } = await helpers.authReq(req, Models)
    const { productId, workspaceId, freeTrial } = req.body
    const parsedQuantity = parseInt(req.body.quantity, 10)
    const quantity = Number.isFinite(parsedQuantity)
      ? Math.min(100, Math.max(1, parsedQuantity))
      : 1

    if (!productId) {
      return res.status(ResponseCodes['500_INTERNAL_SERVER_ERROR']).json({
        error: true,
        message: 'productId is required'
      })
    }

    if (!workspaceId) {
      return res.status(ResponseCodes['500_INTERNAL_SERVER_ERROR']).json({
        error: true,
        message: 'workspaceId is required'
      })
    }

    helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)

    const successUrl = `${ENV.SERVER_URL}/billing/successful?session_id={CHECKOUT_SESSION_ID}`
    const cancelUrl = `${ENV.SERVER_URL}/billing/failed`

    const stripeInstance = getStripe()

    const prices = await stripeInstance.prices.list({
      product: productId,
      active: true,
      limit: 1
    })

    if (!prices.data.length) {
      return res.status(ResponseCodes['500_INTERNAL_SERVER_ERROR']).json({
        error: true,
        message: `No active price found for product ${productId}`
      })
    }

    const lineItems = [{ price: prices.data[0].id, quantity }]

    const sessionParams = {
      mode: 'subscription',
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      metadata: {
        userId: authUserDoc._id.toString(),
        workspaceId: workspaceId.toString(),
        quantity: String(quantity),
        freeTrial: freeTrial ? 'true' : 'false',
      }
    }

    if (freeTrial === true) {
      sessionParams.subscription_data = {
        trial_period_days: 7,
      }
      sessionParams.payment_method_collection = 'always'
    }

    // For free trials we must attach a Stripe customer up-front.
    // This guarantees session.customer is always set, which patchSubscriptionCustomer
    // relies on via the stripeCustomerId stored in SubscriptionCustomer.
    if (freeTrial === true && !authUserDoc.stripeCustomerId) {
      const customer = await stripeInstance.customers.create({
        email: authUserDoc.email || undefined,
        metadata: { userId: authUserDoc._id.toString() },
      })
      await syncUserStripeCustomerId(authUserDoc._id, customer.id, Models)
      authUserDoc.stripeCustomerId = customer.id
    }

    if (authUserDoc.stripeCustomerId) {
      sessionParams.customer = authUserDoc.stripeCustomerId
    } else if (authUserDoc.email) {
      sessionParams.customer_email = authUserDoc.email
    }

    const session = await stripeInstance.checkout.sessions.create(sessionParams)

    res.status(ResponseCodes['200_OK']).json({
      error: false,
      sessionId: session.id,
      url: session.url
    })
  } catch (err) {
    logger.error('postCheckoutSession error:', { eventName: 'POSTCHECKOUTSESSION_ERROR', err: err })
    res.status(ResponseCodes['500_INTERNAL_SERVER_ERROR']).json({
      error: true,
      message: err.message
    })
  }
}

export default handler
