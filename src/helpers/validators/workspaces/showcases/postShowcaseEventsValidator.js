import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    events: Joi.array().items(Joi.object().unknown(true)),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
