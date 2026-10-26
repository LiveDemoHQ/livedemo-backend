import ResponseCodes from '../constants/ResponseCodes.js'
import Joi from '@hapi/joi'

import logger from '../helpers/logger.js'

const corsHeaders = {
  'Access-Control-Max-Age': 600,
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
  'Access-Control-Allow-Credentials': true,
}

function validateBody(body) {
  const schema = Joi.object().keys({
    email: Joi.string().email().required(),
    launchLinkId: Joi.string().optional(),
    launchId: Joi.string().optional(),
  })
  return schema.validate(body)
}

const handler = function (req, res) {
  const { Models } = req.mongo
  let subscriberDoc = null

  return Promise.resolve()
    .then(() => {
      const { error, value } = validateBody(req.body)
      if (error) {
        const err = new Error('Validation failed')
        err.resultResponse = {
          statusCode: ResponseCodes['400_BAD_REQUEST'],
          headers: corsHeaders,
          body: JSON.stringify({ error: error.message }),
        }
        throw err
      }
      return value
    })
    .then((body) => {
      const email = body.email.toLowerCase().trim()
      const launchId = body.launchId || ''

      const checkDuplicate = launchId
        ? Models.LaunchSubscriber.findOne({ email, launchId }).lean()
        : Promise.resolve(null)

      return checkDuplicate.then((existing) => {
        if (existing) {
          return { body, alreadySubscribed: true, existingId: existing._id }
        }

        return new Models.LaunchSubscriber({
          email,
          launchLinkId: body.launchLinkId || '',
          launchId,
        }).save()
          .then((doc) => {
            subscriberDoc = doc
            return { body, alreadySubscribed: false }
          })
      })
    })
    .then((result) => {
      if (result.alreadySubscribed) {
        return result
      }

      const { body } = result
      if (!body.launchLinkId && !body.launchId) {
        return result
      }

      const updates = []

      if (body.launchLinkId) {
        updates.push(
          Models.LaunchLink.findByIdAndUpdate(
            body.launchLinkId,
            { $set: { subscriberId: subscriberDoc._id.toString(), hasSubscribed: true } },
            { new: true }
          )
        )
      }

      if (body.launchId) {
        updates.push(
          Models.LaunchConfig.findByIdAndUpdate(
            body.launchId,
            { $inc: { spotsTaken: 1 } }
          )
        )
      }

      return Promise.all(updates).then(() => result)
    })
    .then((result) => {
      res.set(corsHeaders)
      res.status(ResponseCodes['200_OK'])

      if (result.alreadySubscribed) {
        res.send(JSON.stringify({
          success: true,
          alreadySubscribed: true,
          message: 'This email is already on the waitlist.',
          id: result.existingId,
        }))
        return
      }

      res.send(JSON.stringify({
        success: true,
        alreadySubscribed: false,
        id: subscriberDoc._id,
      }))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_LAUNCH_SUBSCRIBE_FAILED' })
      const resultResponse = error.resultResponse || {
        statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Something went wrong' }),
      }
      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default handler
