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
    allowEmbed: Joi.boolean(),
    showFlowMenu: Joi.boolean(),
    revealLinkHints: Joi.boolean(),
    hintOnMisclick: Joi.boolean(),
    resetScroll: Joi.boolean(),
    keyboardNavigation: Joi.boolean(),
    showLinkSuggestions: Joi.boolean(),
    startScreenId: mongoId,
    // Each flow is checked by normalizeFlows
    flows: Joi.array().items(Joi.object().unknown(true)),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
