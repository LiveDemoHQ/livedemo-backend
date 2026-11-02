import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    gotoType: Joi.string().valid('screen', 'flow', 'website'),
    gotoScreen: Joi.string().max(64).allow('', null),
    gotoFlowId: Joi.string().max(64).allow('', null),
    gotoWebsite: Joi.string().max(1000).allow(''),
    // Captured anchor, checked field by field by normalizeLink
    anchor: Joi.object().unknown(true),
    isPrimary: Joi.boolean(),
    source: Joi.string().valid('capture', 'manual', 'sync'),
    presenterNote: Joi.string().max(2000).allow(''),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
