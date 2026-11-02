import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    name: Joi.string().max(100).required(),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
