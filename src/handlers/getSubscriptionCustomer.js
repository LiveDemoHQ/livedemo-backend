import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { normalizeSubscriptionCustomer } from '../helpers/subscriptionCustomerHelpers.js'

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

    const subscriptionCustomer = await Models.SubscriptionCustomer.findOne({
      userId: authUserDoc._id,
    })
      .populate('cardId', '_id last4 brand expMonth expYear')
      .populate('charges', '_id amount status currency subscriptionType createdAt')
      .populate('subscriptions', '_id type active expired expireDate workspaceIds')
      .lean()

    res.status(ResponseCodes['200_OK']).json({
      error: false,
      subscriptionCustomer: subscriptionCustomer
        ? normalizeSubscriptionCustomer(subscriptionCustomer)
        : null,
    })
  } catch (err) {
    logger.error('getSubscriptionCustomer error:', { eventName: 'GETSUBSCRIPTIONCUSTOMER_ERROR', err: err })
    res.status(ResponseCodes['500_INTERNAL_SERVER_ERROR']).json({
      error: true,
      message: err.message,
    })
  }
}

export default handler
