import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    mode: Joi.string().valid('disabled', 'livedemo', 'smtp').required(),
    // Echoed back from GET, so extra read-only keys are ignored; normalizeEmailSettings checks the rest
    smtp: Joi.object().keys({
      host: Joi.string().max(500).allow('', null),
      port: Joi.alternatives().try(Joi.number(), Joi.string().allow('')).allow(null),
      user: Joi.string().max(500).allow('', null),
      password: Joi.string().max(1000).allow('', null),
      fromEmail: Joi.string().max(500).allow('', null),
      fromName: Joi.string().max(500).allow('', null),
      replyTo: Joi.string().max(500).allow('', null),
    }).unknown(true).allow(null),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
