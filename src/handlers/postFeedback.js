import ResponseCodes from '../constants/ResponseCodes.js'
import helpers from '../helpers/livedemoHelpers.js'
import validateFeedback from '../helpers/validators/feedbackBody.js'

import logger from '../helpers/logger.js'

const corsHeaders = {
  'Access-Control-Max-Age': 600,
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
  'Access-Control-Allow-Credentials': true,
}

const handler = function (req, res) {
  const { Models } = req.mongo

  return Promise.resolve()
    .then(() => {
      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      const { error, value } = validateFeedback(req.body || {})

      if (error) {
        const err = new Error('Validation failed')
        err.resultResponse = {
          statusCode: ResponseCodes['400_BAD_REQUEST'],
          headers: corsHeaders,
          body: JSON.stringify({ error: error.message }),
        }
        throw err
      }

      const doc = {
        userId: authUser._id,
        email: authUser.email || '',
        name: authUser.name || '',
        message: value.message,
        source: value.source || 'chrome-extension',
        extensionVersion: value.extensionVersion || '',
      }

      if (value.workspaceId) {
        doc.workspaceId = value.workspaceId
      }

      return new Models.Feedback(doc).save()
    })
    .then((saved) => {
      res.set(corsHeaders)
      res.status(ResponseCodes['201_CREATED'])
      res.send(JSON.stringify({
        success: true,
        id: saved._id,
      }))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_FEEDBACK_FAILED' })
      const resultResponse = error.resultResponse || {
        statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
        headers: corsHeaders,
        body: JSON.stringify({ error: error.message || 'Failed to save feedback' }),
      }
      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default handler
