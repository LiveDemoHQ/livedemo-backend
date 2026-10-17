import helpers from '../helpers/livedemoHelpers.js'
import validator from 'validator'
import ResponseCodes from '../constants/ResponseCodes.js'
import axios from 'axios'
import ENV from '../envServer.js'
import monq from 'monq'
import FormFieldTypes from '../constants/FormFieldTypes.js'
import { emitDemoEvent } from '../helpers/workspaceEvents.js'

const FORM_FIELD_NAME = {
  EMAIL: 'email',
  NAME: 'name',
}

function isFieldFilled(fieldObj, value) {
  if (fieldObj.type === FormFieldTypes.CHECKBOX) {
    if (!fieldObj.required) {
      return true
    }
    return value === true || value === 'true'
  }

  return value !== undefined && value !== null && String(value).length > 0
}

function isFieldValid(fieldObj, value) {
  if (fieldObj.name === FORM_FIELD_NAME.EMAIL) {
    return validator.isEmail(String(value))
  }

  if (fieldObj.name === FORM_FIELD_NAME.NAME) {
    let str = String(value)
    return str.length > 3 && str.length < 255
  }

  // selector / checkbox / company / website / custom: no extra validation for now
  return true
}

function normalizeFieldValue(fieldObj, value) {
  if (fieldObj.type === FormFieldTypes.CHECKBOX) {
    return value === true || value === 'true'
  }

  return value
}

function validateBodyFromForm(formDoc, body) {
  let fieldsObj = (formDoc.fields || []).reduce((accum, field) => {
    accum[field.name] = field

    return accum
  }, {})

  let jsonBody = body || {}

  let bodyFields = Object.entries(jsonBody).reduce((accum, [key, value]) => {
    if (fieldsObj[key]) {
      accum[key] = normalizeFieldValue(fieldsObj[key], value)
    }

    return accum
  }, {})

  let allRequiredFieldsAreFilled = Object.values(fieldsObj).every(fieldObj => {
    // name/email always required — they have custom format validation
    let isRequired = !!fieldObj.required
      || fieldObj.name === FORM_FIELD_NAME.NAME
      || fieldObj.name === FORM_FIELD_NAME.EMAIL

    if (!isRequired) {
      return true
    }

    return isFieldFilled(fieldObj, bodyFields[fieldObj.name])
  })

  if (!allRequiredFieldsAreFilled) {
    throw new Error('Incorrect data')
  }

  let allFiledsAreValid = Object.entries(bodyFields).every(([key, value]) => {
    return isFieldValid(fieldsObj[key], value)
  })

  if (!allFiledsAreValid) {
    throw new Error('Incorrect data')
  }

  return bodyFields
}

function validateCaptcha(captchaToken) {
  return axios.post(
    `https://www.google.com/recaptcha/api/siteverify?secret=${ENV.CAPTCHA_SECRET_KEY}&response=${captchaToken}`
    )
    .then((res) => {
      if (res.data.success) {
        return true
      } else {

        throw new Error('Invalid captcha')
      }
    })
}

function enqueueDemoLeadCollectionEvent(storyId, workspaceId, leadId, leadData) {
  const client = monq(ENV.DB_URI || 'mongodb://localhost:27017/livedemo_app')
  const queue = client.queue('demoActivityEvents', { collection: 'jobs-monq' })

  return new Promise((resolve, reject) => {
    let jobName = 'lead-collection-event'
    queue.enqueue(jobName, { 
      storyId, 
      workspaceId, 
      leadId: leadId.toString(),
      eventName: 'lead-collection',
      leadData 
    }, function (err, job) {
      if (err) {
        reject(err)
      }
      console.log('Enqueued lead-collection-event:', job.data)
      resolve()
    })
  })
}

const handler = function (req, res) {
  let { Models, conn } = req.mongo


  let formId = req.params.formId
  let captchaToken = req.body && req.body.captchaToken
  let livedemoSessionId = req.headers ? req.headers.livedemosessionid : ''

  return Models.Form.findOne({ _id: formId }).lean()
    .then((formDoc) => {
      if (!formDoc) {
        throw new Error('Form not found')
      }

      if (formDoc.useCaptcha) {
        return validateCaptcha(captchaToken).then(() => formDoc)
      }

      return formDoc
    })
    .then((formDoc) => {
      let bodyFields = validateBodyFromForm(formDoc, req.body)


      let newLead = new Models.Lead({
        formId: formDoc._id,
        storyId: formDoc.storyId,
        liveDemoId: formDoc.liveDemoId,
        screenId: formDoc.screenId,
        workspaceId: formDoc.workspaceId,
        sessionId: livedemoSessionId,
        data: bodyFields
      })

      return newLead.save()
    })
    .then((newLeadDoc) => {
      // if(!ENV.PROCESS_DEMO_ACTIVITY_EVENTS) {
      //   return newLeadDoc
      // }

      if (newLeadDoc.storyId) {

        emitDemoEvent(Models, newLeadDoc.storyId, 'demo.lead', { lead: newLeadDoc })
      }
      
      // Enqueue lead-collection-event
      return enqueueDemoLeadCollectionEvent(
        newLeadDoc.storyId.toString(),
        newLeadDoc.workspaceId.toString(),
        newLeadDoc._id,
        newLeadDoc.data
      )
        .then(() => newLeadDoc)
        .catch((err) => {
          // Log error but don't fail the request if enqueueing fails
          console.error('Failed to enqueue lead-collection-event:', err)
          return newLeadDoc
        })
    })
    .then((newLeadDoc) => {
      return Models.Form.findOneAndUpdate({ _id: formId }, {
        $push: {
          'leads': newLeadDoc._id
        }
      }, {
        new: true,
      })
    })
    .then((newFormDoc) => {

      if (!newFormDoc) {
        throw new Error('Lead couldn\'t be created')
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
        body: JSON.stringify({})
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
