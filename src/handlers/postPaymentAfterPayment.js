import ResponseCodes from '../constants/ResponseCodes.js'
import afterPaymentValidator from '../helpers/validators/oldLambdaRoutes/payments/afterPaymentValidator.js'
import helpers from '../helpers/livedemoHelpers.js'
import EventReporter from '../helpers/eventReporter.js'
import EventNamesEnum from '../constants/EventNamesEnum.js'
import {

  enablePaidPlanUserFeatureFlags,
  setActiveUserSubscription,
} from '../helpers/subscriptionHelpers.js'
import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo
  let requestBody = req.body

  return Promise.resolve().then(() => {
      // Validate request body
      let validatedBody = helpers.validateBody(requestBody, afterPaymentValidator)
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
            error: validatedBody.error.message || 'Validation failed'
          })
        }

        let error = new Error('Validation failed')
        error.resultResponse = resultResponse
        throw error
      }
      requestBody = validatedBody.value
    })
    .then(() => {
      const { chargeId, subscriptionId } = requestBody

      // Get charge and subscription
      let chargePromise = chargeId === '' ? Promise.resolve(null) : Models.Charge.findOne({ _id: chargeId }).lean()
      
      return Promise.all([
        chargePromise,
        Models.Subscription.findOne({ _id: subscriptionId }).lean()
      ])
    })
    .then(([chargeDoc, subDoc]) => {
      if (!subDoc) {
        throw new Error('Subscription not found')
      }

      return setActiveUserSubscription(Models, subDoc.userId, subDoc._id)
        .then(() => ({ chargeDoc, subDoc }))
    })
    .then(({ chargeDoc, subDoc }) => {
      // Report event
      return EventReporter.storeInfoEvent(EventNamesEnum.SUBSCRIPITON_PURCHASED, {
        userId: subDoc.userId,
        chargeDoc,
        subDoc
      })
        .then(() => {
          return { chargeDoc, subDoc }
        })
    })
    .then(({ chargeDoc, subDoc }) => {
      return enablePaidPlanUserFeatureFlags(Models, subDoc.userId, subDoc.type)
        .then(() => ({ chargeDoc, subDoc }))
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
      res.send(JSON.stringify({}))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_PAYMENT_AFTER_PAYMENT_FAILED' })

      let resultResponse
      if (error.resultResponse) {
        resultResponse = error.resultResponse
      } else {
        resultResponse = {
          statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
            'Access-Control-Allow-Credentials': true,
          },
          body: JSON.stringify({})
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default handler
