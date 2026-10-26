import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import FormTypes from '../constants/FormTypes.js'
import FormFieldTypes from '../constants/FormFieldTypes.js'
import postFormValidator from '../helpers/validators/forms/postFormValidator.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let requestBody = null

  let workspaceId = req.params.workspaceId
  let authUserDoc = null

  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser

      let validatedBody = helpers.validateBody(req.body, postFormValidator)
      requestBody = validatedBody.value

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(() => {
      let { storyId, transitionId, screenId, stepId, type } = requestBody

      let formType = FormTypes[type.toUpperCase()]

      let newForm = new Models.Form({
        type: formType,
        fields: [
          {
            label: 'Name',
            name: 'name',
            type: FormFieldTypes.SHORT_TEXT,
            required: true,
            index: 0,
            typeData: {}
          },
          {
            label: 'Email',
            name: 'email',
            type: FormFieldTypes.SHORT_TEXT,
            required: true,
            index: 1,
            typeData: {}
          }
        ],
        useCaptcha: false,
        showTopLabels: false,
        showBackground: false,
        storyId: storyId,
        stepId: stepId,
        screenId: screenId,
        transitionId: transitionId,
        workspaceId: workspaceId,
      })

      return newForm.save()
    })
    .then((newFormDoc) => {
      let { screenId, stepId, transitionId, type } = requestBody

      if(type === FormTypes.STEP) {
        return Models.Screen.findOneAndUpdate({ _id: screenId, 'steps._id': stepId }, {
            $set: {
              'steps.$.view.popup.formId': newFormDoc._id,
              'steps.$.view.popup.alignment': 'center',
              'steps.$.view.popup.showPreviewImage': false,
            }
          }, {
            new: true,
            overwrite: false
          })
          .then((newScreenDoc) => {

            return newFormDoc
          })
      } else if(type === FormTypes.TRANSITION) {
        return Models.Screen.findOneAndUpdate({ _id: screenId,'customTransitions._id': transitionId }, {
            $set: {
              'customTransitions.$.popup.formId': newFormDoc._id,
              'customTransitions.$.popup.alignment': 'center',
              'customTransitions.$.popup.showPreviewImage': false,
            }
          }, {
            new: true,
            overwrite: false
          })
          .then((newScreenDoc) => {

            return newFormDoc
          })
      } else {
        return newFormDoc
      }

    })
    .then((newFormDoc) => {

      if (!newFormDoc) {
        throw new Error('Form couldn\'t be created')
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
        body: JSON.stringify(newFormDoc)
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body)

    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_FORMS_FAILED' })

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
