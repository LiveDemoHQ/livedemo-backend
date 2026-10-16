import Joi from '@hapi/joi'

const objectId = Joi.string().pattern(/^[a-fA-F0-9]{24}$/)

const UNINSTALL_REASONS = [
  'hard-to-use',
  'missing-feature',
  'broken',
  'other-tool',
  'just-trying',
  'other',
]

function validateFeedback(body) {
  const schema = Joi.object().keys({
    message: Joi.string().trim().min(1).max(4000).required(),
    workspaceId: objectId.optional().allow(''),
    extensionVersion: Joi.string().trim().max(40).optional().allow(''),
    source: Joi.string().trim().max(40).optional().allow(''),
  })

  return schema.validate(body)
}

function validateUninstallFeedback(body) {
  const schema = Joi.object().keys({
    reason: Joi.string().valid(...UNINSTALL_REASONS).required(),
    message: Joi.string().trim().max(4000).optional().allow(''),
    extensionVersion: Joi.string().trim().max(40).optional().allow(''),
  })

  return schema.validate(body)
}

export { UNINSTALL_REASONS, validateUninstallFeedback }
export default validateFeedback
