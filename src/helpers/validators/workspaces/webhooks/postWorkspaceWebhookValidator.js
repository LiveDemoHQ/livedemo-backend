import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    kind: Joi.string().max(40),
    url: Joi.string().max(2000).allow('', null),
    measurementId: Joi.string().max(200).allow('', null),
    apiSecret: Joi.string().max(500).allow('', null),
    writeKey: Joi.string().max(500).allow('', null),
    events: Joi.array().items(Joi.string().max(100)),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
