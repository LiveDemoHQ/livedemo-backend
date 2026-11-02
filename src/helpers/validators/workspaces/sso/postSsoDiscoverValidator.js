import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    email: Joi.string().max(254).required(),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
