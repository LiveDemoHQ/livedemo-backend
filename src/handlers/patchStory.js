import helpers from '../helpers/livedemoHelpers.js'
import flixHelpers from '../helpers/flixHelpers.js'
import patchStoryValidator from '../helpers/validators/stories/patchStoryValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import StoryStatuses from '../constants/StoryStatuses.js'
import ScreenTypes from '../constants/ScreenTypes.js'
import ENV from '../envServer.js'
const { STORY_REQUESTS_FOLDER } = ENV
import mongoose from 'mongoose';
const { ObjectId } = mongoose.Types;
import short from 'short-uuid'

import logger from '../helpers/logger.js'

const handler = function(req, res){
  let {Models, conn} = req.mongo

  let requestBody = req.body
  let authUserDoc = null

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId

  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser
      let validatedBody = helpers.validateBody(req.body, patchStoryValidator)
      requestBody = validatedBody.value

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })


    .then(async () => {

      let name = requestBody.name
      let status = requestBody.status

      let updateObj = {}

      if(name || name === '') {
        updateObj.name = name
      }

      if(status) {
        updateObj.status = status
      }

      return Models.Story.findOneAndUpdate({ _id: storyId },  { $set: updateObj }, {
        new: true,
        overwrite: false
      }).lean()
    })
    .then((updatedStory) => {
      logger.info('Story updated - ' + updatedStory._id.toString(16), { eventName: 'PATCH_STORY' })

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
      res.send(JSON.stringify({
        _id: updatedStory._id
      }))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'PATCH_STORY_FAILED' })

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
