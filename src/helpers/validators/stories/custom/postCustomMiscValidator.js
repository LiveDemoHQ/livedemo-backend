import Joi from '@hapi/joi'
import validator from 'validator'

function validateBody(body) {


  let schema = Joi.object().keys({
    isActive: Joi.boolean().required(),
    confettiOnLastStep: Joi.boolean().required(),
    isOmniBarDisabled: Joi.boolean().required(),
    isLiveDemoWatermarkEnabled: Joi.boolean().required(),
    isTabsEnabled: Joi.boolean().required(),
    customCursor: Joi.boolean().optional(),
  })

  const result = schema.validate(body)

  return result
}

export default  validateBody
