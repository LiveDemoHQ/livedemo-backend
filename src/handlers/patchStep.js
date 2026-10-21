import helpers from '../helpers/livedemoHelpers.js'
import patchStepValidator from '../helpers/validators/stories/screens/steps/patchStepValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'

function sanitizeEmbedHtml(raw) {
  if (!raw) return raw
  return Buffer.from(raw, 'utf8').toString('base64')
}

const handler = function (req, res) {
  let { Models, conn } = req.mongo


  let requestBody = null

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let screenId = req.params.screenId
  let stepId = req.params.stepId
  let authUserDoc = null

  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser

      let validatedBody = helpers.validateBody(req.body, patchStepValidator)
      requestBody = validatedBody.value

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(() => {

      const stepView = requestBody.view
      const stepAction = requestBody.action
      const stepAudioId = requestBody.stepAudioId
      const stepAutoPlayConfig = requestBody.autoPlayConfig


      let updateObj = {}

      if (stepView && stepView.content) {
        updateObj['steps.$.view.content'] = stepView.content
      }

      if (stepView && stepView.hotspot && stepView.hotspot.frameX) {
        updateObj['steps.$.view.hotspot.frameX'] = stepView.hotspot.frameX
      }

      if (stepView && stepView.hotspot && stepView.hotspot.frameY) {
        updateObj['steps.$.view.hotspot.frameY'] = stepView.hotspot.frameY
      }

      if (stepView && stepView.hotspot && stepView.hotspot.placement) {
        updateObj['steps.$.view.hotspot.placement'] = stepView.hotspot.placement
      }

      for (const colorField of ['backgroundColor', 'textColor', 'ringsColor']) {
        if (stepView && stepView.hotspot && stepView.hotspot[colorField] !== undefined) {
          updateObj[`steps.$.view.hotspot.${colorField}`] = stepView.hotspot[colorField]
        }
      }

      if (stepView && stepView.pointer && stepView.pointer.selector) {
        updateObj['steps.$.view.pointer.selector'] = stepView.pointer.selector
      }

      if (stepView && stepView.pointer && stepView.pointer.selectorLocation && stepView.pointer.selectorLocation) {
        updateObj['steps.$.view.pointer.selectorLocation'] = stepView.pointer.selectorLocation
      }

      if (stepView && stepView.pointer && stepView.pointer.placement) {
        updateObj['steps.$.view.pointer.placement'] = stepView.pointer.placement
      }

      if (stepView && stepView.pointer && stepView.pointer.targetMode) {
        updateObj['steps.$.view.pointer.targetMode'] = stepView.pointer.targetMode
      }

      if (stepView && stepView.pointer && stepView.pointer.tooltipX !== undefined) {
        updateObj['steps.$.view.pointer.tooltipX'] = stepView.pointer.tooltipX
      }

      if (stepView && stepView.pointer && stepView.pointer.tooltipY !== undefined) {
        updateObj['steps.$.view.pointer.tooltipY'] = stepView.pointer.tooltipY
      }

      if (stepView && stepView.pointer && stepView.pointer.pulsatingBorder !== undefined) {
        updateObj['steps.$.view.pointer.pulsatingBorder'] = !!stepView.pointer.pulsatingBorder
      }

      if (stepView && stepView.pointer && stepView.pointer.showOverlay !== undefined) {
        updateObj['steps.$.view.pointer.showOverlay'] = !!stepView.pointer.showOverlay
      }

      if (stepView && stepView.pointer && stepView.pointer.overlayBackgroundColor !== undefined) {
        updateObj['steps.$.view.pointer.overlayBackgroundColor'] = stepView.pointer.overlayBackgroundColor
      }

      if (stepView && stepView.popup && stepView.popup.title !== undefined) {
        updateObj['steps.$.view.popup.title'] = stepView.popup.title
      }

      if (stepView && stepView.popup && stepView.popup.description) {
        updateObj['steps.$.view.popup.description'] = stepView.popup.description
      }

      if (stepView && stepView.popup && stepView.popup.buttons) {
        updateObj['steps.$.view.popup.buttons'] = stepView.popup.buttons
      }

      if (stepView && stepView.popup && stepView.popup.type) {
        updateObj['steps.$.view.popup.type'] = stepView.popup.type
      }

      if (stepView && stepView.popup && stepView.popup.embedHtmlContent !== undefined) {
        updateObj['steps.$.view.popup.embedHtmlContent'] = sanitizeEmbedHtml(stepView.popup.embedHtmlContent)
      }

      if (stepView && stepView.popup && stepView.popup.alignment) {
        updateObj['steps.$.view.popup.alignment'] = stepView.popup.alignment
      }

      if (stepView && stepView.popup && stepView.popup.showOverlay !== undefined) {
        updateObj['steps.$.view.popup.showOverlay'] = stepView.popup.showOverlay
      }

      if (stepView && stepView.popup && stepView.popup.overlayBackgroundColor !== undefined) {
        updateObj['steps.$.view.popup.overlayBackgroundColor'] = stepView.popup.overlayBackgroundColor
      }

      if (stepView && stepView.popup && stepView.popup.showBackground !== undefined) {
        updateObj['steps.$.view.popup.showBackground'] = stepView.popup.showBackground
      }

      if (stepView && stepView.popup && stepView.popup.textColor !== undefined) {
        updateObj['steps.$.view.popup.textColor'] = stepView.popup.textColor
      }

      if (stepView && stepView.popup && stepView.popup.showPreviewImage !== undefined) {
        updateObj['steps.$.view.popup.showPreviewImage'] = stepView.popup.showPreviewImage
      }

      if (stepView && stepView.popup && stepView.popup.previewImageUrl !== undefined) {
        updateObj['steps.$.view.popup.previewImageUrl'] = stepView.popup.previewImageUrl
      }

      if (stepView && stepView.viewType) {
        updateObj['steps.$.view.viewType'] = stepView.viewType
      }

      if (stepView && stepView.showStepNumbers !== undefined) {
        updateObj['steps.$.view.showStepNumbers'] = stepView.showStepNumbers
      }

      if (stepView && stepView.showFooter !== undefined) {
        updateObj['steps.$.view.showFooter'] = stepView.showFooter
      }

      if (stepView && stepView.hideBackButton !== undefined) {
        updateObj['steps.$.view.hideBackButton'] = stepView.hideBackButton
      }

      if (stepView && stepView.hideContent !== undefined) {
        updateObj['steps.$.view.hideContent'] = stepView.hideContent
      }

      if (stepView && stepView.nextButtonText) {
        updateObj['steps.$.view.nextButtonText'] = stepView.nextButtonText
      }

      if (stepAction && stepAction.selector) {
        updateObj['steps.$.action.selector'] = stepAction.selector
      }

      if (stepAction && stepAction.actionType) {
        updateObj['steps.$.action.actionType'] = stepAction.actionType
      }

      if(stepAudioId || stepAudioId === '') {
        updateObj['steps.$.stepAudioId'] = stepAudioId
      }

      if(stepAutoPlayConfig && stepAutoPlayConfig.enabled !== undefined) {
        updateObj['steps.$.autoPlayConfig.enabled'] = stepAutoPlayConfig.enabled
      }

      if(stepAutoPlayConfig && stepAutoPlayConfig.type) {
        updateObj['steps.$.autoPlayConfig.type'] = stepAutoPlayConfig.type
      }

      if(stepAutoPlayConfig && stepAutoPlayConfig.delay) {
        updateObj['steps.$.autoPlayConfig.delay'] = stepAutoPlayConfig.delay
      }

      if (Object.keys(updateObj).length !== 0) {

        return Models.Screen.findOneAndUpdate({ _id: screenId, 'steps._id': stepId }, { $set: updateObj }, {
            new: true,
            overwrite: false
          })
          .then((result) => {

            return Models.Screen.findOne({
                _id: screenId
              })
              .populate({
                path: 'steps.view.popup.formId',
                model: 'Form',
              })
              .populate({
                path: 'steps.view.popup.buttons.gotoScreen',
                model: 'Screen',
              })
              .populate({
                path: 'steps.stepAudioId',
                model: 'Audio',
              })
              .lean()
              .then((newScreenDoc) => {

                let newStepDoc = newScreenDoc.steps.find(step => step._id.toString() === stepId)

                return newStepDoc
              })
          })
      } else {

        return null
      }

    })
    .then((updatedStepDoc) => {

      if (!updatedStepDoc) {
        throw new Error('Step couldn\'t be updated')
      }

      const resultResponse = {
        statusCode: ResponseCodes['200_OK'],
        headers: {
          'Access-Control-Max-Age': 600,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
          // Required for CORS support to work
          'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
        },
        body: JSON.stringify(updatedStepDoc)
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body)

    })
    .catch((error) => {
      console.log(error)

      let resultResponse
      if (error.resultResponse) {

        resultResponse = error.resultResponse
      } else {


        resultResponse = {
          statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
            // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
          },
          body: ''
        }

      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body)
    })
}

export default  handler
