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
    message: Joi.string().max(20000).allow('').required(),
    source: Joi.string().valid('text', 'voice', 'suggestion'),
    // Player position from the client (shape-checked again by parsePlayerState)
    demoId: Joi.string().max(64).allow('', null),
    stepNumber: Joi.number().integer().allow(null),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
