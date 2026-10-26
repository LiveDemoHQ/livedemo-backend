import Joi from '@hapi/joi'
import OnboardingGoalsTypes from '../../../../constants/OnboardingGoalsTypes.js'

function validateBody(body) {


  let schema = Joi.object().keys({
    name: Joi.string().trim().min(1).max(120).optional(),
    timezone: Joi.string().optional(),
    onboarding: Joi.object().keys({
      goals: Joi.array()
        .items(Joi.string().valid(...Object.values(OnboardingGoalsTypes.ONBOARDING_GOALS)))
        .optional(),
    }).optional(),
    emailConfig: Joi.object().keys({
      isSubscribed: Joi.boolean().optional(),
    }).optional(),
  })

  const result = schema.validate(body)

  return result
}

export default  validateBody