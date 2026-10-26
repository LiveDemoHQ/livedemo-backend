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
    personName: Joi.string().required(),
    platform: Joi.string().required(),
    linkedinUrl: Joi.string().optional(),
  })
  return schema.validate(body)
}

const handler = function (req, res) {
  const { Models } = req.mongo

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
      return new Models.LaunchLink({
        personName: body.personName,
        platform: body.platform,
        linkedinUrl: body.linkedinUrl || '',
      }).save()
    })
    .then((doc) => {
      res.set(corsHeaders)
      res.status(ResponseCodes['200_OK'])
      res.send(JSON.stringify(doc))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_LAUNCH_LINKS_FAILED' })
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
