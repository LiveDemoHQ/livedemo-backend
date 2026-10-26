import helpers from '../helpers/livedemoHelpers.js'
import postFormFieldsValidator from '../helpers/validators/forms/postFormFieldsValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import FormFieldTypes from '../constants/FormFieldTypes.js'
import mongoose from 'mongoose'

import logger from '../helpers/logger.js'

const { ObjectId } = mongoose.Types

const handler = function (req, res) {
  let { Models } = req.mongo

  let requestBody = null
  let workspaceId = req.params.workspaceId
  let formId = req.params.formId
  let authUserDoc = null

  return Promise.resolve().then(async () => {
      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser

      let validatedBody = helpers.validateBody(req.body, postFormFieldsValidator)
      requestBody = validatedBody.value

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(() => {
      return Models.Form.findOne({ _id: formId }).lean()
    })
    .then((formDoc) => {
      if (!formDoc) {
        throw new Error('Form not found')
      }

      let fieldType = requestBody.type || FormFieldTypes.SHORT_TEXT
      let fieldIndex = requestBody.index !== undefined
        ? requestBody.index
        : (formDoc.fields || []).length

      let typeData = requestBody.typeData || {}
      if (fieldType === FormFieldTypes.SELECTOR && !typeData.options) {
        typeData = { ...typeData, options: [] }
      }
      if (fieldType === FormFieldTypes.CHECKBOX && typeData.checked === undefined) {
        typeData = { ...typeData, checked: false }
      }

      let newField = {
        _id: new ObjectId(),
        label: requestBody.label,
        name: requestBody.name,
        type: fieldType,
        required: requestBody.required !== undefined ? requestBody.required : true,
        index: fieldIndex,
        typeData,
      }

      return Models.Form.findOneAndUpdate(
        { _id: formId },
        { $push: { fields: newField } },
        { new: true }
      )
    })
    .then((updatedFormDoc) => {
      if (!updatedFormDoc) {
        throw new Error('Form field couldn\'t be created')
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
      logger.error(error, { eventName: 'POST_FORM_FIELDS_FAILED' })

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
