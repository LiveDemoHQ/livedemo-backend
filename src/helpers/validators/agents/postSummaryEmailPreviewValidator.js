import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    subject: Joi.string().max(1000).allow(''),
    body: Joi.string().max(20000).allow(''),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
