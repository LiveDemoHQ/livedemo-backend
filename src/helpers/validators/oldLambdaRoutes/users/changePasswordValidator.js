import Joi from '@hapi/joi'

function validateBody(body) {


  let schema = Joi.object().keys({
    newPassword: Joi.string().min(8).max(128).required()
  })

  const result = schema.validate(body)

  return result
}

export default  validateBody