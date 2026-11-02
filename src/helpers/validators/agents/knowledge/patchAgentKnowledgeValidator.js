import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    title: Joi.string().max(500).allow(''),
    enabled: Joi.boolean(),
    rawText: Joi.string().allow(''),
    url: Joi.string().max(2000).allow(''),
    refreshHours: Joi.number().allow(null),
    maxPages: Joi.number().allow(null),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
