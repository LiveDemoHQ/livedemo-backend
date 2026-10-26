import helpers from '../helpers/livedemoHelpers.js'
import patchScreenValidator from '../helpers/validators/stories/screens/patchScreenValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { httpError, wouldBreakRrwebChainOrder } from '../helpers/rrwebScreenGuards.js'

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

      let validatedBody = helpers.validateBody(req.body, patchScreenValidator)
      requestBody = validatedBody.value

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(async () => {
      let index = requestBody.index
      let name = requestBody.name
      let startTime = requestBody.startTime
      let endTime = requestBody.endTime
      let playbackRate = requestBody.playbackRate

      let updateObj = {}

      if(startTime  || startTime  === 0) {
        updateObj.startTime  = startTime
      }

      if(endTime  || endTime  === 0) {
        updateObj.endTime  = endTime
      }

      if(playbackRate) {
        updateObj.playbackRate  = playbackRate
      }

      if(index || index === 0) {
        updateObj.index = index
      }

      if(name || name === '') {
        updateObj.name = name
      }

      if (index || index === 0) {
        const allScreens = await Models.Screen.find({ storyId }).lean()
        const proposed = allScreens.map((s) => {
          if (String(s._id) === String(screenId)) {
            return {
              _id: s._id,
              index,
              recordingRole: s.recordingRole,
              baseScreenId: s.baseScreenId,
              fromTimeMs: s.fromTimeMs,
            }
          }
          return {
            _id: s._id,
            index: s.index,
            recordingRole: s.recordingRole,
            baseScreenId: s.baseScreenId,
            fromTimeMs: s.fromTimeMs,
          }
        })
        const breakReason = wouldBreakRrwebChainOrder(proposed)
        if (breakReason) {
          httpError(ResponseCodes['409_CONFLICT'], breakReason)
        }
      }

      return Models.Screen.db.collection('screens').findOneAndUpdate({ _id: new ObjectId(screenId) },  { $set: updateObj }, {
        returnDocument: 'after'
      })
    })
    .then((screenDoc) => {

      const resultResponse = {
        statusCode: ResponseCodes['200_OK'],
        headers: {
          'Access-Control-Max-Age': 600,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
          'Access-Control-Allow-Credentials': true,
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(JSON.stringify(screenDoc))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'PATCH_SCREEN_FAILED' })

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

export default  handler
