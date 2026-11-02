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
    sourceKind: Joi.string().max(20).required(),
    sourceId: mongoId.required(),
    claimToken: Joi.string().max(2000).required(),
    browserSessionId: Joi.string().max(200).allow('', null),
    workspaceId: mongoId.allow('', null),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
