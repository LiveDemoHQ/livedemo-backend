import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    name: Joi.string().max(500).allow(''),
    layout: Joi.string().valid('gallery', 'playlist'),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
