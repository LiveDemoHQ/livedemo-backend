import helpers from '../helpers/livedemoHelpers.js'
import patchFormFieldsValidator from '../helpers/validators/forms/patchFormFieldsValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models } = req.mongo

  let requestBody = null
  let workspaceId = req.params.workspaceId
  let formId = req.params.formId
  let fieldId = req.params.fieldId
  let authUserDoc = null

  return Promise.resolve().then(async () => {
      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser

      let validatedBody = helpers.validateBody(req.body, patchFormFieldsValidator)
      requestBody = validatedBody.value

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(() => {
      let updateObj = {}

      if (requestBody.label !== undefined) {
        updateObj['fields.$.label'] = requestBody.label
      }
      if (requestBody.name !== undefined) {
        updateObj['fields.$.name'] = requestBody.name
      }
      if (requestBody.type !== undefined) {
        updateObj['fields.$.type'] = requestBody.type
      }
      if (requestBody.required !== undefined) {
        updateObj['fields.$.required'] = requestBody.required
      }
      if (requestBody.index !== undefined) {
        updateObj['fields.$.index'] = requestBody.index
      }
      if (requestBody.typeData !== undefined) {
        updateObj['fields.$.typeData'] = requestBody.typeData
      }

      return Models.Form.findOneAndUpdate(
        { _id: formId, 'fields._id': fieldId },
        { $set: updateObj },
        { new: true }
      )
    })
    .then((updatedFormDoc) => {
      if (!updatedFormDoc) {
        throw new Error('Form field couldn\'t be updated')
      }

      const resultResponse = {
        statusCode: ResponseCodes['200_OK'],
        headers: {
          'Access-Control-Max-Age': 600,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
          'Access-Control-Allow-Credentials': true,
        },
        body: JSON.stringify(updatedFormDoc)
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body)
    })
    .catch((error) => {
      logger.error(error, { eventName: 'PATCH_FORM_FIELDS_FAILED' })

      let resultResponse
      if (error.resultResponse) {
        resultResponse = error.resultResponse
      } else {
        resultResponse = {
          statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
            'Access-Control-Allow-Credentials': true,
          },
          body: ''
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body)
    })
}

export default handler
