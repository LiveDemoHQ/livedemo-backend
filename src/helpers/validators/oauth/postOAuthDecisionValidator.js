import Joi from '@hapi/joi'

// Authorize query echoed back by the consent page: unknown OAuth parameters are ignored (RFC 6749)
function validateBody(body) {
  const schema = Joi.object().keys({
    approve: Joi.boolean().required(),
    client_id: Joi.string().max(500).required(),
    redirect_uri: Joi.string().max(2000).required(),
    response_type: Joi.string().max(40),
    code_challenge: Joi.string().max(500),
    code_challenge_method: Joi.string().max(20),
    state: Joi.string().max(2000).allow(''),
    resource: Joi.string().max(2000).allow(''),
  }).unknown(true)

  const result = schema.validate(body)

  return result
}

export default validateBody
