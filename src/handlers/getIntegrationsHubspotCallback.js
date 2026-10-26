import ResponseCodes from '../constants/ResponseCodes.js'
import ENV from '../envServer.js'
import axios from 'axios'
import mongoose from 'mongoose';
import logger from '../helpers/logger.js'

const { ObjectId } = mongoose.Types;

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  logger.info('ENV', { eventName: 'ENV' })
  logger.info(JSON.stringify(ENV, null, 2), { eventName: 'GET_INTEGRATIONS_HUBSPOT_CALLBACK' })

  return Promise.resolve().then(async () => {
      const HubspotCreds = ENV.OAUTH2Credentials?.HubSpot
      const code = req.query.code

      if (!HubspotCreds) {
        throw new Error('HubSpot OAuth not configured')
      }

      if (!code) {
        throw new Error('Authorization code not provided')
      }

      // Exchange code for token
      const tokenResponse = await axios.post('https://api.hubapi.com/oauth/v1/token', new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: HubspotCreds.client_id,
        client_secret: HubspotCreds.client_secret,
        redirect_uri: HubspotCreds.redirect_uris[0],
        code: code
      }), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      })

      const tokenRes = tokenResponse.data

      if (!tokenRes.access_token) {
        throw new Error('Failed to obtain access token from HubSpot')
      }

      // Get token info to extract user details
      const tokenInfoResponse = await axios.get(`https://api.hubapi.com/oauth/v1/access-tokens/${tokenRes.access_token}`, {
        headers: {
          'Authorization': `Bearer ${tokenRes.access_token}`
        }
      })

      const tokenInfo = tokenInfoResponse.data

      // Get user info from HubSpot
      const userInfoResponse = await axios.get('https://api.hubapi.com/integrations/v1/me', {
        headers: {
          'Authorization': `Bearer ${tokenRes.access_token}`
        }
      })

      const userInfo = userInfoResponse.data

      // Calculate expiresAt
      const expiresAt = new Date(Date.now() + (tokenRes.expires_in * 1000))

      // Extract user ID and email (required fields)
      const hubspotUserId = tokenInfo.user_id || tokenInfo.user || userInfo.user || userInfo.userId
      const hubspotUserEmail = tokenInfo.user || tokenInfo.email || userInfo.userEmail || userInfo.email

      if (!hubspotUserId || !hubspotUserEmail) {
        throw new Error('Failed to obtain required user information from HubSpot')
      }
      // Get workspaceId from state parameter (format: workspaceId=abc123)
      let workspaceId = req.query.workspaceId
      if (!workspaceId && req.query.state) {
        try {
          const decodedState = decodeURIComponent(req.query.state)
          const stateMatch = decodedState.match(/workspaceId=([^&]+)/)
          if (stateMatch && stateMatch[1]) {
            workspaceId = stateMatch[1]
          }
        } catch (error) {
          logger.error('Error parsing state parameter:', { eventName: 'ERROR_PARSING_STATE_PARAMETER_FAILED', err: error })
        }
      }

      if (!workspaceId) {
        throw new Error('Workspace ID is required but not provided in the callback')
      }

      // Prepare HubspotToken data
      const hubspotTokenData = {
        accessToken: tokenRes.access_token,
        refreshToken: tokenRes.refresh_token || '',
        expiresAt: expiresAt,
        hubspotUserId: hubspotUserId,
        hubspotUserEmail: hubspotUserEmail,
        workspaceId: workspaceId ? new ObjectId(workspaceId) : null,
        hubspotUserFirstName: userInfo.firstName || userInfo.first_name || '',
        hubspotUserLastName: userInfo.lastName || userInfo.last_name || '',
        hubspotUserPhone: userInfo.phone || '',
        hubspotUserCompany: userInfo.portalId?.toString() || '',
        hubspotUserCompanyId: userInfo.portalId?.toString() || userInfo.hubId?.toString() || '',
        hubspotUserCompanyName: userInfo.portalName || userInfo.accountName || '',
        hubspotUserCompanyDomain: userInfo.domain || ''
      }

      // Find existing token by hubspotUserId or hubspotUserEmail
      let existingToken = await Models.HubspotToken.findOne({
        $or: [
          { hubspotUserId: hubspotTokenData.hubspotUserId },
          { hubspotUserEmail: hubspotTokenData.hubspotUserEmail }
        ]
      }).lean()

      if (existingToken) {
        // Update existing token
        await Models.HubspotToken.findOneAndUpdate(
          { _id: existingToken._id },
          hubspotTokenData
        )
      } else {
        // Create new token
        await new Models.HubspotToken(hubspotTokenData).save()
      }

      // Update workspace integration status if workspaceId is provided
      if (workspaceId) {
        await Models.Workspace.findOneAndUpdate(
          { _id: new ObjectId(workspaceId) },
          { 'integrations.hubspot': true }
        )
      }

      // Redirect to frontend with success
      const redirectUrl = `${ENV.SERVER_URL}/integrations/hubspot/success`

      const resultResponse = {
        statusCode: ResponseCodes['302_FOUND'],
        headers: {
          'Location': redirectUrl,
          'Access-Control-Max-Age': 600,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
          'Access-Control-Allow-Credentials': true,
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.redirect(redirectUrl)
    })
    .catch((error) => {
      logger.error('HubSpot callback error:', { eventName: 'HUBSPOT_CALLBACK_ERROR', err: error })

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
      res.send('')
    })
}

export default handler

