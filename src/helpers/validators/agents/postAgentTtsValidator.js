import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    text: Joi.string().max(20000).allow('').required(),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
