
import Joi from '@hapi/joi'
import validator from 'validator'

function validateBody(body) {


  let schema = Joi.object().keys({
    name: Joi.string().required(),
    capturedEvents: Joi.array(),
    videoBase64: Joi.string().optional().allow(''),
    screenshots: Joi.object(),
    windowMeasures: Joi.object(),
    videoStartMs: Joi.number().required(),
    videoEndMs: Joi.number().required(),
    cursorPositions: Joi.array().items(Joi.object({
      frameX: Joi.number().required(),
      frameY: Joi.number().required(),
      timeMs: Joi.number().required()
    })).optional(),
    storyId: Joi.string().custom((storyId) => {
      if (validator.isMongoId(storyId)) {

        return storyId
      } else {

        throw new Error('incorrect storyId')
      }
    }).optional(),
    workspaceId: Joi.string().custom((workspaceId) => {
      if (validator.isMongoId(workspaceId)) {

        return workspaceId
      } else {

        throw new Error('incorrect workspaceId')
      }
    }).required(),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
