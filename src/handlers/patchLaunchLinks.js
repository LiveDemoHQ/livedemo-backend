import ResponseCodes from '../constants/ResponseCodes.js'
import Joi from '@hapi/joi'

import logger from '../helpers/logger.js'

const corsHeaders = {
  'Access-Control-Max-Age': 600,
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
  'Access-Control-Allow-Credentials': true,
}

function validateBody(body) {
  const schema = Joi.object().keys({
    hasOpen: Joi.boolean().optional(),
    hasSubscribed: Joi.boolean().optional(),
  }).min(1)
  return schema.validate(body)
}

const handler = function (req, res) {
  const { Models } = req.mongo
  const { linkId } = req.params

  return Promise.resolve()
    .then(() => {
      const { error, value } = validateBody(req.body)
      if (error) {
        const err = new Error('Validation failed')
        err.resultResponse = {
          statusCode: ResponseCodes['400_BAD_REQUEST'],
          headers: corsHeaders,
          body: JSON.stringify({ error: error.message }),
        }
        throw err
      }
      return value
    })
    .then((body) => {
      const updateObj = {}
      if (typeof body.hasOpen === 'boolean') updateObj.hasOpen = body.hasOpen
      if (typeof body.hasSubscribed === 'boolean') updateObj.hasSubscribed = body.hasSubscribed

      return Models.LaunchLink.findByIdAndUpdate(
        linkId,
        { $set: updateObj },
        { new: true }
      )
    })
    .then((doc) => {
      if (!doc) {
        const err = new Error('Not found')
        err.resultResponse = {
          statusCode: ResponseCodes['404_NOT_FOUND'],
          headers: corsHeaders,
          body: JSON.stringify({ error: 'LaunchLink not found' }),
        }
        throw err
      }
      res.set(corsHeaders)
      res.status(ResponseCodes['200_OK'])
      res.send(JSON.stringify(doc))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'PATCH_LAUNCH_LINKS_FAILED' })
      const resultResponse = error.resultResponse || {
        statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Something went wrong' }),
      }
      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default handler
