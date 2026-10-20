import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import postFreeActivateValidator from '../helpers/validators/oldLambdaRoutes/payments/postFreeActivate.js'
import SubscriptionTypes from '../constants/SubscriptionTypes.js'
import SubscriptionTypesExpireDates from '../constants/SubscriptionTypesExpireDates.js'
import SubscriptionTypesRank from '../constants/SubscriptionTypesRank.js'
import SubscriptionTypesMembersAllowed from '../constants/SubscriptionTypesMembersAllowed.js'
import {
  getOrCreateSubscriptionCustomer,
  linkSubscriptionToCustomer,
} from '../helpers/subscriptionCustomerHelpers.js'
import {
  enablePaidPlanUserFeatureFlags,
  setActiveUserSubscription,
  avatarLimitsFor,
} from '../helpers/subscriptionHelpers.js'

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
      let validatedBody = helpers.validateBody(requestBody, postFreeActivateValidator)
      if (validatedBody.error) {
        throw new Error(validatedBody.error.message || 'Validation failed')
      }
      requestBody = validatedBody.value
    })
    .then(() => {
      const workspaceId = requestBody.workspaceId
      const subscriptionType = requestBody.subscriptionType.toUpperCase()

      if (!SubscriptionTypes[subscriptionType]) {
        throw new Error('Incorrect SubscriptionType')
      }

      // Verify workspace can be purchased
      return Models.Workspace.findOne({ _id: workspaceId }).lean()
        .then((workspace) => {
          if (!workspace) {
            throw new Error('Workspace not found')
          }
          if (SubscriptionTypesRank[workspace.type] >= SubscriptionTypesRank[subscriptionType]) {
            throw new Error('Cannot pay for a Workspace which is already purchased')
          }
          return { workspace, subscriptionType }
        })
    })
    .then(async ({ workspace, subscriptionType }) => {
      // Verify user has freeActivate feature flag
      // Note: This assumes workspaceMembers exist - may need to be adapted
      if (!authUserDoc.featureFlags || !authUserDoc.featureFlags.freeActivate) {
        throw new Error('Cannot activate for free')
      }

      const subscriptionCustomer = await getOrCreateSubscriptionCustomer(
        Models,
        authUserDoc._id,
        { autoPay: false }
      )

      // Create subscription
      const subscription = await new Models.Subscription({
        type: SubscriptionTypes[subscriptionType],
        workspaceIds: [workspace._id],
        subscriptionCustomerId: subscriptionCustomer._id,
        active: true,
        userId: authUserDoc._id,
        autoPay: false,
        expired: false,
        expireDate: SubscriptionTypesExpireDates[subscriptionType.toLowerCase()],
        membersAllowed: SubscriptionTypesMembersAllowed[subscriptionType] || 1,
        ...avatarLimitsFor(SubscriptionTypes[subscriptionType])
      }).save()

      await setActiveUserSubscription(Models, authUserDoc._id, subscription._id)
      await enablePaidPlanUserFeatureFlags(Models, authUserDoc._id, subscription.type)

      await linkSubscriptionToCustomer(
        Models,
        subscription._id,
        subscriptionCustomer._id
      )

      await Models.Workspace.findOneAndUpdate(
        { _id: workspace._id },
        { $push: { subscriptions: subscription._id } }
      )

      await Models.User.findOneAndUpdate(
        { _id: subscription.userId },
        { $push: { subscriptions: subscription._id } }
      )

      return { subscription, workspace }
    })
    .then(({ subscription, workspace }) => {
      // Update workspace type
      return Models.Workspace.findOneAndUpdate(
        { _id: workspace._id },
        { $set: { type: SubscriptionTypes[subscription.type] } }
      )
        .then(() => {
          // Update user feature flags
          return Models.User.findOneAndUpdate(
            { _id: authUserDoc._id },
            { $set: { 'featureFlags.freeActivate': false } }
          )
            .then(() => {
              return { subscription, requires3dSecure: false, ThreeDSecureIframeUrl: '' }
            })
        })
    })
    .then(({ subscription, requires3dSecure, ThreeDSecureIframeUrl }) => {
      // TODO: Trigger afterPayment handler if needed
      // This could be done via a job queue or direct call

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
        '3dSecure': requires3dSecure,
        '3dSecureUrl': ThreeDSecureIframeUrl,
        error: false,
        charge: '',
      }))
    })
    .catch((error) => {
      console.log(error)

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

export default handler
