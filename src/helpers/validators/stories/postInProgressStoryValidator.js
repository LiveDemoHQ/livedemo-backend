import Joi from '@hapi/joi'
import validator from 'validator'

function validateBody(body) {


  let schema = Joi.object().keys({
    name: Joi.string().required(),
    workspaceId: Joi.string().custom((workspaceId) => {
      if (validator.isMongoId(workspaceId)) {

        return workspaceId
      } else {

        throw new Error('incorrect workspaceId')
      }
    }).required(),
    recordingType: Joi.string().valid('video_screenshot', 'html_delta').optional(),
    rrweb: Joi.object().keys({
      version: Joi.string().optional(),
      href: Joi.string().optional().allow(''),
      viewport: Joi.object().keys({
        width: Joi.number().optional(),
        height: Joi.number().optional(),
      }).optional(),
    }).optional(),
    tabInfo: Joi.object().optional(),
    windowMeasures: Joi.object().optional(),
    mode: Joi.string().valid('guided', 'sandbox').optional(),
    targetSandboxId: Joi.string().hex().length(24).optional(),
    flowName: Joi.string().max(120).allow('').optional(),
  })

  const result = schema.validate(body)

  return result
}

export default  validateBody
