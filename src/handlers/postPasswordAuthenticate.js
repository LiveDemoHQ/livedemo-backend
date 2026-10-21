import ResponseCodes from '../constants/ResponseCodes.js'
import userValidators from '../helpers/validators/userValidators.js'
import authUtils from '../helpers/authUtils.js'
import claimBrowserSessionForUser from '../helpers/claimBrowserSessionForUser.js'
import { getPostAuthRedirectPath } from '../helpers/emailHelpers.js'
import { assertNotSsoEnforced } from '../helpers/sso.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let requestBody = req.body

  return Promise.resolve().then(() => {
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

      // Validate login form
      let validationResult = userValidators.validateLoginForm(requestBody)

      if (!validationResult.success) {
        const resultResponse = {
          statusCode: ResponseCodes['400_BAD_REQUEST'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
            // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
          },
          body: JSON.stringify(validationResult)
        }

        let error = new Error('Validation failed')
        error.resultResponse = resultResponse
        throw error
      }
    })
    .then(() => {
      const email = requestBody.email
      const password = requestBody.password

      // Authenticate user
      return authUtils.authenticateUser(email, password, Models.User)
    })
    .then((userDataSaved) => assertNotSsoEnforced(Models, userDataSaved.email, userDataSaved._id).then(() => userDataSaved))
    .then((userDataSaved) => {
      // Create auth token
      return authUtils.createTokenForUser(userDataSaved, Models.AuthToken)
        .then((authToken) => {
          return {
            userDataSaved,
            authToken
          }
        })
    })
    .then(({ userDataSaved, authToken }) => {
      return claimBrowserSessionForUser(requestBody.browserSessionId, userDataSaved, Models)
        .then(() => ({ userDataSaved, authToken }))
    })
    .then(({ userDataSaved, authToken }) => {
      const redirectPath = getPostAuthRedirectPath(userDataSaved)
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
        id: userDataSaved._id,
        email: userDataSaved.email,
        timezone: userDataSaved.timezone,
        name: userDataSaved.name,
        token: authToken.token,
        workspaceMembers: userDataSaved.workspaceMembers,
        featureFlags: userDataSaved.featureFlags,
        emailVerified: userDataSaved.emailVerified === true,
        redirectPath
      }))
    })
    .catch((error) => {
      console.log(error)

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
            error: error.message || 'Incorrect Email Or Password'
          })
        }

      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default  handler
