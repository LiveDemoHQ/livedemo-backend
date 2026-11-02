import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    domain: Joi.string().max(300).required(),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
