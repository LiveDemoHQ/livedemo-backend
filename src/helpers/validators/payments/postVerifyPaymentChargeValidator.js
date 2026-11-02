import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    id: Joi.string().max(500).required(),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
