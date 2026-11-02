import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    returnTo: Joi.string().max(2000).allow('', null),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
