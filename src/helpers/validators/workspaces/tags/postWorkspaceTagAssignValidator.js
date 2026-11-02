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
    kind: Joi.string().max(40).required(),
    ids: Joi.array().items(mongoId).max(500).required(),
    tagId: mongoId.required(),
    on: Joi.boolean().required(),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
