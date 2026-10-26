import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import mongoose from 'mongoose'

import logger from '../helpers/logger.js'

const { ObjectId } = mongoose.Types

const handler = function (req, res) {
  let { Models } = req.mongo

  let workspaceId = req.params.workspaceId
  let formId = req.params.formId
  let fieldId = req.params.fieldId
  let authUserDoc = null

  return Promise.resolve().then(async () => {
      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser
      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(() => {
      return Models.Form.findOne({ _id: formId }).lean()
    })
    .then((formDoc) => {
      if (!formDoc) {
        throw new Error('Form not found')
      }

      let field = (formDoc.fields || []).find((f) => String(f._id) === String(fieldId))
      if (!field) {
        throw new Error('Form field not found')
      }

      let fieldObjectId = ObjectId.isValid(fieldId) ? new ObjectId(fieldId) : fieldId

      return Models.Form.findOneAndUpdate(
        { _id: formId },
        { $pull: { fields: { _id: fieldObjectId } } },
        { new: true }
      )
    })
    .then((updatedFormDoc) => {
      if (!updatedFormDoc) {
        throw new Error('Form field couldn\'t be deleted')
      }

      // Reindex remaining fields so drag order stays contiguous
      let fields = (updatedFormDoc.fields || [])
        .slice()
        .sort((a, b) => (a.index || 0) - (b.index || 0))
        .map((field, index) => {
          field.index = index
          return field
        })

      updatedFormDoc.fields = fields
      return updatedFormDoc.save()
    })
    .then((updatedFormDoc) => {
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
      logger.error(error, { eventName: 'DELETE_FORM_FIELDS_FAILED' })

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
