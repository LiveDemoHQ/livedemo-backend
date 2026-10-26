import helpers from '../helpers/livedemoHelpers.js'
import patchTransitionValidator from '../helpers/validators/stories/screens/transitions/patchTransitionValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let requestBody = null

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let screenId = req.params.screenId
  let transitionId = req.params.transitionId
  let authUserDoc = null

  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser

      let validatedBody = helpers.validateBody(req.body, patchTransitionValidator)
      requestBody = validatedBody.value

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(() => {

      const selector = requestBody.pointer && requestBody.pointer.selector
      const selectorLocation = requestBody.pointer && requestBody.pointer.selectorLocation
      const pointerPlacement = requestBody.pointer && requestBody.pointer.placement
      const pointerTargetMode = requestBody.pointer && requestBody.pointer.targetMode
      const pointerTooltipX = requestBody.pointer && requestBody.pointer.tooltipX
      const pointerTooltipY = requestBody.pointer && requestBody.pointer.tooltipY
      const gotoType = requestBody.gotoType
      const gotoWebsite = requestBody.gotoWebsite
      const gotoScreen = requestBody.gotoScreen

      const frameX = requestBody && requestBody.hotspot && requestBody.hotspot.frameX
      const frameY = requestBody && requestBody.hotspot && requestBody.hotspot.frameY
      const hotspotPlacement = requestBody && requestBody.hotspot && requestBody.hotspot.placement
      const type = requestBody.type
      const content = requestBody.content


      let updateObj = {}
      if (selector || selector === "") {
        updateObj['customTransitions.$.pointer.selector'] = selector
      }

      if (pointerPlacement) {
        updateObj['customTransitions.$.pointer.placement'] = pointerPlacement
      }

      if (selectorLocation) {
        updateObj['customTransitions.$.pointer.selectorLocation'] = selectorLocation
      }

      if (pointerTargetMode) {
        updateObj['customTransitions.$.pointer.targetMode'] = pointerTargetMode
      }

      if (pointerTooltipX !== undefined) {
        updateObj['customTransitions.$.pointer.tooltipX'] = pointerTooltipX
      }

      if (pointerTooltipY !== undefined) {
        updateObj['customTransitions.$.pointer.tooltipY'] = pointerTooltipY
      }

      if (gotoType) {
        updateObj['customTransitions.$.gotoType'] = gotoType
      }

      if (gotoWebsite) {
        updateObj['customTransitions.$.gotoWebsite'] = gotoWebsite
      }

      if (gotoScreen) {
        updateObj['customTransitions.$.gotoScreen'] = gotoScreen
      }

      if (frameX || frameX === 0) {
        updateObj['customTransitions.$.hotspot.frameX'] = frameX
      }

      if (frameY || frameY === 0) {
        updateObj['customTransitions.$.hotspot.frameY'] = frameY
      }

      if (hotspotPlacement) {
        updateObj['customTransitions.$.hotspot.placement'] = hotspotPlacement
      }

      if (type) {
        updateObj['customTransitions.$.type'] = type
      }

      if (content || content === "") {
        updateObj['customTransitions.$.content'] = content
      }

      if (Object.keys(updateObj).length !== 0) {

        return Models.Screen.findOneAndUpdate({
            _id: screenId,
            'customTransitions._id': transitionId
          }, { $set: updateObj }, {
            new: true,
            overwrite: false
          })
          .then((newScreenDoc) => {

            return Models.Screen.findOne({ _id: screenId, 'customTransitions._id': transitionId})
              .populate('customTransitions.gotoScreen', 'name _id')
              .lean()
              .then((screenDoc) => {
                return screenDoc.customTransitions.find(nav => nav._id.toString() === transitionId)
              })
          })
      } else {

        return null
      }

    })
    .then((updatedNavDoc) => {

      if (!updatedNavDoc) {
        throw new Error('Transition couldn\'t be updated')
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
        body: JSON.stringify(updatedNavDoc)
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body)

    })
    .catch((error) => {
      logger.error(error, { eventName: 'PATCH_TRANSITION_FAILED' })

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

