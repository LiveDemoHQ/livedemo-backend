import ResponseCodes from '../constants/ResponseCodes.js'
import validateCancelSubscriptionValidator from '../helpers/validators/oldLambdaRoutes/jobs/validateCancelSubscription.js'
import helpers from '../helpers/livedemoHelpers.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo
  let requestBody = req.body

  return Promise.resolve().then(() => {
      // Validate request body
      let validatedBody = helpers.validateBody(requestBody, validateCancelSubscriptionValidator)
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
      const { subscriptionId } = requestBody

      logger.info('cancelSubscription for ' + subscriptionId, { eventName: 'POST_JOB_CANCEL_SUBSCRIPTION' })

      // Get subscription
      return Models.Subscription.findOne({ _id: subscriptionId }).lean()
        .then((subDoc) => {
          if (!subDoc) {
            throw new Error('Subscription not found')
          }

          return subDoc
        })
    })
    .then((subDoc) => {
      // Update subscription and jobs
      const featureFlags = {
        channelExports: false,
        instantUpdates: false,
        workspaceExports: false,
        freeActivate: false
      }

      return Promise.all([
        Models.Subscription.updateOne(
          { _id: subscriptionId },
          { $set: { expired: true, active: false } }
        ),
        Models.Job.updateMany(
          { subscriptionId: subscriptionId },
          {
            $set: {
              disabled: true,
              nextRunAt: null
            }
          }
        )
      ])
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
      logger.error(error, { eventName: 'POST_JOB_CANCEL_SUBSCRIPTION_FAILED' })

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
          body: JSON.stringify({
            error: error.message || 'Something went wrong'
          })
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default handler
