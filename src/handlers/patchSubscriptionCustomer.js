import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import patchSubscriptionCustomerValidator from '../helpers/validators/subscriptionCustomer/patchSubscriptionCustomerValidator.js'
import {

  normalizeSubscriptionCustomer,
  syncStripeSubscriptionAutoPay,
} from '../helpers/subscriptionCustomerHelpers.js'
import logger from '../helpers/logger.js'

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

    const validatedBody = helpers.validateBody(
      req.body,
      patchSubscriptionCustomerValidator
    )

    if (validatedBody.error) {
      return res.status(ResponseCodes['500_INTERNAL_SERVER_ERROR']).json({
        error: true,
        message: validatedBody.error.message || 'Validation failed',
      })
    }

    const { autoPay } = validatedBody.value

    const subscriptionCustomer = await Models.SubscriptionCustomer.findOne({
      userId: authUserDoc._id,
    }).lean()

    if (!subscriptionCustomer) {
      return res.status(ResponseCodes['404_NOT_FOUND']).json({
        error: true,
        message: 'Subscription customer profile not found',
      })
    }

    await syncStripeSubscriptionAutoPay(
      subscriptionCustomer.stripeSubscriptionId,
      autoPay
    )

    const updated = await Models.SubscriptionCustomer.findOneAndUpdate(
      { _id: subscriptionCustomer._id },
      { $set: { autoPay } },
      { new: true }
    )
      .populate('cardId', '_id last4 brand expMonth expYear')
      .populate('charges', '_id amount status currency subscriptionType createdAt')
      .populate('subscriptions', '_id type active expired expireDate workspaceIds')
      .lean()

    await Models.Subscription.updateMany(
      { userId: authUserDoc._id, active: true },
      { $set: { autoPay } }
    )

    res.status(ResponseCodes['200_OK']).json({
      error: false,
      subscriptionCustomer: normalizeSubscriptionCustomer(updated),
    })
  } catch (err) {
    logger.error('patchSubscriptionCustomer error:', { eventName: 'PATCHSUBSCRIPTIONCUSTOMER_ERROR', err: err })
    res.status(ResponseCodes['500_INTERNAL_SERVER_ERROR']).json({
      error: true,
      message: err.message,
    })
  }
}

export default handler
