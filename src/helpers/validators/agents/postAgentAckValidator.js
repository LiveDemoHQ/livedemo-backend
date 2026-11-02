import Joi from '@hapi/joi'
import validator from 'validator'

const mongoId = Joi.string().custom((id) => {
  if (validator.isMongoId(String(id))) {
    return id
  }
  throw new Error('incorrect id')
})

function validateBody(body) {
  const schema = Joi.object().keys({
    sessionId: mongoId.required(),
    type: Joi.string().max(40).required(),
    data: Joi.object().unknown(true).allow(null),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
