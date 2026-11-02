import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    apiKey: Joi.string().max(1000).required(),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
