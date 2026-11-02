import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    question: Joi.string().max(2000).required(),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
