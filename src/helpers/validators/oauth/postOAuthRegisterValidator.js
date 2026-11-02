import Joi from '@hapi/joi'

// RFC 7591 client metadata: unknown fields MUST be ignored, so only the ones we read are typed
function validateBody(body) {
  const schema = Joi.object().keys({
    // Presence and https are checked by the handler (RFC 7591 invalid_redirect_uri)
    redirect_uris: Joi.array().items(Joi.string().max(2000)),
    client_name: Joi.string().max(500).allow(''),
  }).unknown(true)

  const result = schema.validate(body)

  return result
}

export default validateBody
