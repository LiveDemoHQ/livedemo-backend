import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    idpSsoUrl: Joi.string().max(2000).allow('', null),
    idpEntityId: Joi.string().max(2000).allow('', null),
    idpCert: Joi.string().max(20000).allow('', null),
    enabled: Joi.boolean(),
    enforced: Joi.boolean(),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
