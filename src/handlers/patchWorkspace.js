import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import patchWorkspaceValidator from '../helpers/validators/oldLambdaRoutes/workspaces/patchWorkspaceValidator.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let workspaceId = req.params.workspaceId
  let authUserDoc = null
  let requestBody = null

  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser

      // Validate user has access to workspace
      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)

      // Validate request body
      let validatedBody = helpers.validateBody(req.body, patchWorkspaceValidator)
      requestBody = validatedBody.value
    })
    .then(async () => {
      // Check if user is admin by fetching the workspace
      const workspaceDoc = await Models.Workspace.findOne({ _id: workspaceId }).lean()
      
      if (!workspaceDoc) {
        const resultResponse = {
          statusCode: ResponseCodes['404_NOT_FOUND'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
            // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
          }
        }

        let error = new Error('Workspace not found')
        error.resultResponse = resultResponse
        throw error
      }

      // Validate user is admin
      if (!workspaceDoc.adminUser || workspaceDoc.adminUser.toString() !== authUserDoc._id.toString()) {
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

        let error = new Error('User is not admin')
        error.resultResponse = resultResponse
        throw error
      }
    })
    .then(async () => {
      const invitedEmails = requestBody.invitedEmails
      const name = requestBody.name

      let updateObj = {}

      if(invitedEmails) {
        updateObj.invitedEmails = invitedEmails
      }

      if(name || name === '') {
        updateObj.name = name
      }

      if(requestBody.analyticsExcludedIps) {

        updateObj.analyticsExcludedIps = [...new Set(requestBody.analyticsExcludedIps)]
      }

      return Models.Workspace.findOneAndUpdate(
        { _id: workspaceId },
        {
          $set: updateObj
        },
        {
          new: true
        }
      ).lean()
    })
    .then((workspaceDoc) => {
      if (!workspaceDoc) {
        const resultResponse = {
          statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
            // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
          }
        }

        let error = new Error('Workspace not found')
        error.resultResponse = resultResponse
        throw error
      }

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
      res.send(JSON.stringify(workspaceDoc))
    })
    .catch((error) => {
      console.log(error)

      let resultResponse
      if (error.resultResponse) {

        resultResponse = error.resultResponse
      } else {


        resultResponse = {
          statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
            // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
          },
          body: JSON.stringify({
            error: error.message
          })
        }

      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default  handler
