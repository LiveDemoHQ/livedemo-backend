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
    story: Joi.object().keys({
      screens: Joi.array().items(Joi.object().keys({ _id: mongoId.required() }).unknown(true)).min(1).required(),
    }).unknown(true).required(),
    screens: Joi.array().items(Joi.object().keys({
      screenDoc: Joi.object().keys({
        _id: mongoId.required(),
        recordingRole: Joi.string().valid('base', 'delta'),
        baseScreenId: Joi.when('recordingRole', {
          is: 'delta',
          then: mongoId.required(),
          otherwise: Joi.any(),
        }),
      }).unknown(true).required(),
      events: Joi.array().required(),
      imageData: Joi.string().allow(''),
      videoData: Joi.string().allow(''),
    })).min(1).required(),
  })

  return schema.validate(body)
}

export default validateBody
