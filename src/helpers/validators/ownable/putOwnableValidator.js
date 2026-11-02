import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    enabled: Joi.boolean().required(),
    ctaLabel: Joi.string().max(200).allow(''),
    includeKnowledge: Joi.boolean(),
    claimTokenTtlHours: Joi.number(),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
