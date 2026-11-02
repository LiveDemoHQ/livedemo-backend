import Joi from '@hapi/joi'

// RFC 6749 token request: unknown parameters (scope, resource, client_secret...) are ignored
function validateBody(body) {
  const schema = Joi.object().keys({
    grant_type: Joi.string().max(100).required(),
    code: Joi.string().max(2000),
    code_verifier: Joi.string().max(500),
    redirect_uri: Joi.string().max(2000),
    client_id: Joi.string().max(500),
    refresh_token: Joi.string().max(2000),
  }).unknown(true)

  const result = schema.validate(body)

  return result
}

export default validateBody
