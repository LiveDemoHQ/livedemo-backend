import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import updateUserValidator from '../helpers/validators/oldLambdaRoutes/users/updateUser.js'
import { getUserByAccessToken } from '../helpers/authHelpers.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let authUserDoc = null
  let requestBody = null

  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser, authToken }) => {
      authUserDoc = authUser

      // Validate request body
      let validatedBody = helpers.validateBody(req.body, updateUserValidator)
      requestBody = validatedBody.value

      if (!requestBody) {
        const resultResponse = {
          statusCode: ResponseCodes['400_BAD_REQUEST'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
            // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
          }
        }

        let error = new Error('Invalid request body')
        error.resultResponse = resultResponse
        throw error
      }

      // Get user by access token
      return getUserByAccessToken(authToken, Models.User, Models.AuthToken)
    })
    .then((userData) => {
      const newName = requestBody.name
      const newTimezone = requestBody.timezone
      const newOnboardingGoals = requestBody.onboarding?.goals
      const newIsSubscribed = requestBody.emailConfig?.isSubscribed
      let hasUpdates = false

      let updateObj = {}

      if (typeof newName === 'string' && newName.trim()) {
        updateObj.name = newName.trim()
        hasUpdates = true
      }

      if (newTimezone) {
        updateObj.timezone = newTimezone
        hasUpdates = true
      }

      if (Array.isArray(newOnboardingGoals)) {
        updateObj['onboarding.goals'] = newOnboardingGoals
        hasUpdates = true
      }

      if (typeof newIsSubscribed === 'boolean') {
        updateObj['emailConfig.isSubscribed'] = newIsSubscribed
        updateObj['emailConfig.unsubscribedAt'] = newIsSubscribed ? null : new Date()
        hasUpdates = true
      }

      if (hasUpdates) {
        return Models.User.findOneAndUpdate(
          { _id: userData._id },
          { ...updateObj },
          { new: true }
        )
      } else {
        return Promise.resolve(userData)
      }
    })
    .then((userData) => {
      const resultResponse = {
        statusCode: ResponseCodes['200_OK'],
        headers: {
          'Access-Control-Max-Age': 600,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
          // Required for CORS support to work
          'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(JSON.stringify({
        id: userData._id,
        email: userData.email,
        name: userData.name,
        timezone: userData.timezone,
        onboarding: userData.onboarding,
        emailConfig: userData.emailConfig,
      }))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'PATCH_USERS_FAILED' })

      let resultResponse
      if (error.resultResponse) {

        resultResponse = error.resultResponse
      } else {


        resultResponse = {
          statusCode: ResponseCodes['400_BAD_REQUEST'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
            // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
          },
          body: JSON.stringify({
            error: error.message || 'Something went wrong, please try again'
          })
        }

      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default  handler
