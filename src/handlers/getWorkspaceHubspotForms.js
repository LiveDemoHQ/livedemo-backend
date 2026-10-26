import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import axios from 'axios'
import mongoose from 'mongoose';
import logger from '../helpers/logger.js'

const { ObjectId } = mongoose.Types;
const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let workspaceId = req.params.workspaceId
  let authUserDoc = null

  return Promise.resolve()
    .then(async () => {
      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser
      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(async () => {
      // Check if workspace has HubSpot integration enabled
      const workspaceDoc = await Models.Workspace.findOne({
        _id: workspaceId
      }).lean()

      if (!workspaceDoc) {
        const resultResponse = {
          statusCode: ResponseCodes['404_NOT_FOUND'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
            'Access-Control-Allow-Credentials': true,
          }
        }

        res.set(resultResponse.headers)
        res.status(resultResponse.statusCode)
        res.send(JSON.stringify({ error: 'Workspace not found' }))
        return
      }

      // Check if HubSpot integration is enabled
      if (!workspaceDoc.integrations?.hubspot) {
        const resultResponse = {
          statusCode: ResponseCodes['400_BAD_REQUEST'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
            'Access-Control-Allow-Credentials': true,
          }
        }

        res.set(resultResponse.headers)
        res.status(resultResponse.statusCode)
        res.send(JSON.stringify({ error: 'HubSpot integration is not enabled for this workspace' }))
        return
      }

      // Get HubSpot token for this workspace
      const hubspotToken = await Models.HubspotToken.findOne({
        workspaceId: new ObjectId(workspaceId)
      }).lean()

      if (!hubspotToken || !hubspotToken.accessToken) {
        const resultResponse = {
          statusCode: ResponseCodes['400_BAD_REQUEST'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
            'Access-Control-Allow-Credentials': true,
          }
        }

        res.set(resultResponse.headers)
        res.status(resultResponse.statusCode)
        res.send(JSON.stringify({ error: 'HubSpot token not found for this workspace' }))
        return
      }

      // Check if token is expired and refresh if needed
      let accessToken = hubspotToken.accessToken

      if (hubspotToken.expiresAt && new Date(hubspotToken.expiresAt) < new Date()) {
        // Token is expired, refresh it
        try {
          const refreshedToken = await helpers.refreshHubspotToken(hubspotToken, Models)
          accessToken = refreshedToken.accessToken
        } catch (refreshError) {
          logger.error('Error refreshing HubSpot token:', { eventName: 'ERROR_REFRESHING_HUBSPOT_TOKEN_FAILED', data: { detail: refreshError } })

          let statusCode = ResponseCodes['401_UNAUTHORIZED']
          let errorMessage = 'Failed to refresh HubSpot token'

          if (refreshError.message.includes('refresh token not available')) {
            statusCode = ResponseCodes['400_BAD_REQUEST']
            errorMessage = 'HubSpot token has expired and no refresh token is available'
          } else if (refreshError.message.includes('OAuth not configured')) {
            statusCode = ResponseCodes['500_INTERNAL_SERVER_ERROR']
            errorMessage = 'HubSpot OAuth not configured'
          }

          const resultResponse = {
            statusCode: statusCode,
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
            error: errorMessage,
            message: refreshError.response?.data?.message || refreshError.message 
          }))
          return
        }
      }

      // Fetch HubSpot forms
      try {
        const formsResponse = await axios.get('https://api.hubapi.com/forms/v2/forms', {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        })

        const forms = Array.isArray(formsResponse.data) ? formsResponse.data : []

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
        res.send(JSON.stringify(forms))
      } catch (error) {
        logger.error('Error fetching HubSpot forms:', { eventName: 'ERROR_FETCHING_HUBSPOT_FORMS_FAILED', err: error })

        const resultResponse = {
          statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
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
          error: 'Failed to fetch HubSpot forms',
          message: error.response?.data?.message || error.message 
        }))
      }
    })
    .catch((error) => {
      logger.error('getWorkspaceHubspotForms error:', { eventName: 'GETWORKSPACEHUBSPOTFORMS_ERROR', err: error })

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
          }
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(JSON.stringify({ error: error.message || 'Internal server error' }))
    })
}

export default handler

