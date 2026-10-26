import ResponseCodes from '../constants/ResponseCodes.js'
import validateAutoPayValidator from '../helpers/validators/oldLambdaRoutes/jobs/validateAutoPay.js'
import SubscriptionTypes from '../constants/SubscriptionTypes.js'
import WorkspaceTypes from '../constants/WorkspaceTypes.js'
import helpers from '../helpers/livedemoHelpers.js'
import { triggerPostChargeInternal } from '../helpers/paymentHelpers.js'
import { getPrimarySubscriptionWorkspaceId, getSubscriptionWorkspaceIds } from '../helpers/subscriptionHelpers.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo
  let requestBody = req.body

  return Promise.resolve().then(() => {
      // Validate request body
      let validatedBody = helpers.validateBody(requestBody, validateAutoPayValidator)
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
      const { subscriptionId, chargeId } = requestBody

      // Get charge and subscription
      return Promise.all([
        Models.Charge.findOne({ _id: chargeId }).lean(),
        Models.Subscription.findOne({ _id: subscriptionId }).lean()
      ])
    })
    .then(([chargeDoc, subDoc]) => {
      if (!chargeDoc || !subDoc) {
        throw new Error('Charge or subscription not found')
      }

      // Get user data
      return Models.User.findOne({ _id: subDoc.userId }).lean()
        .then((userDoc) => {
          if (!userDoc) {
            throw new Error('User not found')
          }

          return { chargeDoc, subDoc, userDoc }
        })
    })
    .then(({ chargeDoc, subDoc, userDoc }) => {
      // If autoPay is enabled, trigger chargeInternal
      if (subDoc.autoPay && userDoc.defaultCardId) {
        const primaryWorkspaceId = getPrimarySubscriptionWorkspaceId(subDoc)
        if (!primaryWorkspaceId) {
          return { chargeDoc, subDoc, userDoc }
        }

        return triggerPostChargeInternal(
          userDoc._id.toString(),
          userDoc.defaultCardId.toString(),
          chargeDoc.currency,
          subDoc.type,
          primaryWorkspaceId.toString(),
          true,
          Models,
          conn
        )
          .then(() => {
            return { chargeDoc, subDoc, userDoc }
          })
          .catch((err) => {
            logger.error('Error triggering postChargeInternal:', { eventName: 'ERROR_TRIGGERING_POSTCHARGEINTERNAL_FAILED', err: err })
            // Continue even if chargeInternal fails
            return { chargeDoc, subDoc, userDoc }
          })
      } else {
        return Promise.resolve({ chargeDoc, subDoc, userDoc })
      }
    })
    .then(({ chargeDoc, subDoc, userDoc }) => {
      // Update subscription, workspace, and jobs
      const featureFlags = {
        channelExports: false,
        instantUpdates: false,
        workspaceExports: false
      }

      const workspaceIds = getSubscriptionWorkspaceIds(subDoc)

      return Promise.all([
        Models.Subscription.updateOne(
          { _id: subDoc._id },
          { $set: { expired: true, active: false } }
        ),
        ...workspaceIds.map((workspaceId) =>
          Models.Workspace.updateOne(
            { _id: workspaceId },
            { $set: { type: WorkspaceTypes.EMPTY } }
          )
        ),
        Models.Job.updateMany(
          { subscriptionId: subDoc._id },
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
      logger.error(error, { eventName: 'POST_JOB_FINALIZE_SUBSCRIPTION_FAILED' })

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
