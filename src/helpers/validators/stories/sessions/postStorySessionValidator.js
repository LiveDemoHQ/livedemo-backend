import Joi from '@hapi/joi'
import validator from 'validator'

function validateBody(body) {


  let schema = Joi.object().keys({
    stepsCount: Joi.number().optional(),
    showcaseSessionId: Joi.string().hex().length(24).optional()
  })

  const result = schema.validate(body)

  return result
}

export default  validateBody
