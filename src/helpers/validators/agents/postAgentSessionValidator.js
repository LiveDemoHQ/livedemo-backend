import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    // Host pages identify visitors with their own objects: name / email are typed, the rest is ignored
    visitor: Joi.object().keys({
      name: Joi.string().max(500).allow('', null),
      email: Joi.string().max(500).allow('', null),
    }).unknown(true).allow(null),
    personalization: Joi.object().keys({
      acct: Joi.string().max(2000).allow('', null),
      company: Joi.string().max(500).allow('', null),
      firstName: Joi.string().max(500).allow('', null),
    }).unknown(true).allow(null),
    source: Joi.object().keys({
      channel: Joi.string().max(40).allow('', null),
      trigger: Joi.string().max(40).allow('', null),
      pageUrl: Joi.string().max(5000).allow('', null),
      referrer: Joi.string().max(5000).allow('', null),
      utm: Joi.object().unknown(true).allow(null),
    }).allow(null),
    capturedVia: Joi.string().max(40).allow('', null),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
