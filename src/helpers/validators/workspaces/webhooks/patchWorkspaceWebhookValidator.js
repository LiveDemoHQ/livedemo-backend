import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    url: Joi.string().max(2000).allow(''),
    events: Joi.array().items(Joi.string().max(100)),
    enabled: Joi.boolean(),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
