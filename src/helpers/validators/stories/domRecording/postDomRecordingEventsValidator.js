import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    events: Joi.array(),
    clickThumbnails: Joi.array(),
    viewport: Joi.object().unknown(true).allow(null),
    href: Joi.string().max(10000).allow('', null),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
