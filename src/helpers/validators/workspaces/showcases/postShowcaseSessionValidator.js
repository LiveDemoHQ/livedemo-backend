import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    delivery: Joi.string().max(20).allow(''),
    referrer: Joi.string().max(5000).allow(''),
    utm: Joi.object().unknown(true).allow(null),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
