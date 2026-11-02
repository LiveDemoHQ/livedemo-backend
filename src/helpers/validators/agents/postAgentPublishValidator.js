import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    isPublished: Joi.boolean().required(),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
