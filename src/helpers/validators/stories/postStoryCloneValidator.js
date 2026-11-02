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
    name: Joi.string().max(500).allow(''),
    workspaceId: mongoId.allow(''),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
