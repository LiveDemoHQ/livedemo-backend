import helpers from '../helpers/livedemoHelpers.js'
import patchScreenValidator from '../helpers/validators/stories/screens/patchScreenPopupsValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import ENV from '../envServer.js'
import popupTypes from '../constants/ScreenPopupTypes.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let requestBody = null

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let screenId = req.params.screenId
  let authUserDoc = null

  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser

      let validatedBody = helpers.validateBody(req.body, patchScreenValidator)
      requestBody = validatedBody.value

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(async () => {
      let enabled = requestBody.enabled
      let type = requestBody.type
      let formId = requestBody.formId

      let updateObj = {}

      // if (enabled || enabled === false) {
      //   updateObj['popups.enabled'] = enabled
      // }

      if (type) {
        updateObj['popups.type'] = type
      }

      // if (formId) {
      //
      //   updateObj['popups.formId'] = formId
      // } else if (formId === '') {
      //
      //   updateObj['popups.formId'] = null
      // }

      return Models.Screen_Screenshot.findOneAndUpdate({ _id: screenId }, {
        $set: updateObj
      }, {
        new: true,
        overwrite: false
      })
        .populate('popups.formId')

    })
    .then((newScreenDoc) => {
      if (newScreenDoc.popups.type === popupTypes.FORM && !newScreenDoc.popups.formId) {

        let newForm = new Models.Form({
          fields: [
            {
              label: 'Name',
              name: 'name',
              required: true,
              typeData: {}
            },
            {
              label: 'Email',
              name: 'email',
              required: true,
              typeData: {}
            }
          ],
          useCaptcha: false,
          showTopLabels: false,
          showBackground: false,
          storyId: storyId,
          screenId: screenId,
          workspaceId: workspaceId,
        })

        return newForm.save()
          .then((newFormDoc) => {
            return Models.Screen_Screenshot.findOneAndUpdate({ _id: screenId }, {
                $set: {
                  ['popups.formId']: newFormDoc._id,
                  ['popups.alignment']: 'center',
                  ['popups.showPreviewImage']: false,
                }
              }, {
                new: true,
                overwrite: false
              })
              .populate('popups.formId')

          })
          .then((updatedScreenDoc) => {

            return updatedScreenDoc
          })

      } else {

        return newScreenDoc
      }
    })
    .then((screenDoc) => {

      const resultResponse = {
        statusCode: ResponseCodes['200_OK'],
        headers: {
          'Access-Control-Max-Age': 600,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
          // Required for CORS support to work
          'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(JSON.stringify(screenDoc.popups))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'PATCH_SCREEN_POPUPS_FAILED' })

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
