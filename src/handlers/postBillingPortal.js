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
    const stripeInstance = getStripe()

    let stripeCustomerId = authUserDoc.stripeCustomerId

    if (!stripeCustomerId) {
      const customer = await stripeInstance.customers.create({
        email: authUserDoc.email || undefined,
        metadata: { userId: authUserDoc._id.toString() },
      })
      await syncUserStripeCustomerId(authUserDoc._id, customer.id, Models)
      stripeCustomerId = customer.id
    }

    const returnUrl = `${ENV.SERVER_URL}/billing`

    const session = await stripeInstance.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    })

    res.status(ResponseCodes['200_OK']).json({
      error: false,
      url: session.url,
    })
  } catch (err) {
    logger.error('postBillingPortal error:', { eventName: 'POSTBILLINGPORTAL_ERROR', err: err })
    res.status(ResponseCodes['500_INTERNAL_SERVER_ERROR']).json({
      error: true,
      message: err.message,
    })
  }
}

export default handler
