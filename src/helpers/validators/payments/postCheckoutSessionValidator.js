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
    productId: Joi.string().max(200).required(),
    workspaceId: mongoId.required(),
    quantity: Joi.number().integer().min(1),
    freeTrial: Joi.boolean(),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
