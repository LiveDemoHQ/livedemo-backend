import helpers from '../helpers/livedemoHelpers.js'
import postStoryPublishValidator from '../helpers/validators/stories/postStoryPublish.js'
import ResponseCodes from '../constants/ResponseCodes.js'

import ENV from '../envServer.js'
const { STORY_REQUESTS_FOLDER } = ENV
import mongoose from 'mongoose';
import logger from '../helpers/logger.js'

const { ObjectId } = mongoose.Types;


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

      let validatedBody = helpers.validateBody(req.body, postStoryPublishValidator)
      requestBody = validatedBody.value

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(() => {

      let isPublished = requestBody.isPublished

      return Models.Story.findOneAndUpdate({ _id: storyId }, { $set: { isPublished: isPublished } }, { new: true })
        .then(() => {

          return Models.Story.findOne({
              _id: storyId
            })
            .populate({
              path: 'screens',
              populate: [
                {
                  path: 'customTransitions.gotoScreen',
                  model: 'Screen',
                  select: '_id name'
                },
                {
                  path: 'steps.view.formId',
                  model: 'Form',
                },
              ],
              select: '_id name type steps customTransitions imageUrl index imageUrl asset',
              options: { sort: { 'index': 1 } }
            })
        })
    })
    .then((newStoryDoc) => {

      if (!newStoryDoc) {
        throw new Error('Story couldn\'t be published')
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
        body: JSON.stringify(newStoryDoc)
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body)

    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_STORY_PUBLISH_FAILED' })

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
