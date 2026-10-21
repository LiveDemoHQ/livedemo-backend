import Joi from '@hapi/joi'
import validator from 'validator'
import mongoose from "mongoose";
import ButtonEffects from '../../../../../constants/ButtonEffects.js'

function validateBody(body) {

  let button = Joi.object().keys({
    _id: Joi.string().optional(),
    index: Joi.number().optional(),
    text: Joi.string().allow(null, '').optional(), // screen | website | none
    gotoType: Joi.string().allow(null, '').optional(), // screen | website | next | none
    gotoWebsite:Joi.string().allow(null, '').optional(),
    gotoScreen: Joi.string().allow(null, '').optional(),
    textColor: Joi.string().allow(null, '').optional(),// buttonColor
    backgroundColor: Joi.string().allow(null, '').optional(),// buttonColor
    buttonEffect: Joi.string().valid(...Object.values(ButtonEffects)).allow(null, '').optional(),
  })

  let schema = Joi.object().keys({
    view: Joi.object().keys({
      viewType: Joi.string().optional(),
      content: Joi.string().allow('').optional(),
      pointer: {
        selector: Joi.string().allow(null, '').optional(),
        selectorLocation: Joi.object().keys({
          positionX: Joi.number().optional(),
          positionY: Joi.number().optional(),
          width: Joi.number().optional(),
          height: Joi.number().optional(),
        }).optional(),
        placement: Joi.string().optional(),
        targetMode: Joi.string().valid('pick', 'select', 'none').optional(),
        tooltipX: Joi.number().optional(),
        tooltipY: Joi.number().optional(),
        pulsatingBorder: Joi.boolean().optional(),
        showOverlay: Joi.boolean().optional(),
        overlayBackgroundColor: Joi.string().allow('').optional(),
      },
      hotspot: {
        frameX: Joi.number().optional(),
        frameY: Joi.number().optional(),
        placement: Joi.string().optional(),
      },
      popup: {
        type: Joi.string().optional(),
        showOverlay: Joi.boolean().optional(),
        overlayBackgroundColor: Joi.string().allow('').optional(),
        showBackground: Joi.boolean().optional(),
        showPreviewImage: Joi.boolean().optional(),
        previewImageUrl: Joi.string().allow('').optional(),
        title: Joi.string().allow('').optional(),
        description: Joi.string().allow('').optional(),
        alignment: Joi.string().optional(),
        buttons: Joi.array().items(button),
        embedHtmlContent: Joi.string().allow('', null).optional(),
      },
      placement: Joi.string().optional(),
      showFooter: Joi.boolean().optional(),
      hideBackButton: Joi.boolean().optional(),
      hideContent: Joi.boolean().optional(),
      showStepNumbers: Joi.boolean().optional(),
      nextButtonText: Joi.string().allow('').optional(),
    }).optional(),
    action: Joi.object().keys({
      actionType: Joi.string().optional(),
      selector: Joi.string().allow(null, '').optional(),
    }).optional(),
    autoPlayConfig: {
      enabled: Joi.boolean().optional(),
      type: Joi.string().allow('').optional(),
      delay: Joi.number().optional()
    },
    stepAudioId: Joi.string().custom((stepAudioId) => {
      if (validator.isMongoId(stepAudioId)) {

        return stepAudioId
      } else {

        if(!stepAudioId) {

          return ''
        }

        throw new Error('Incorrect screenId')
      }
    }).optional()
  })

  const result = schema.validate(body)

  return result
}

export default  validateBody
