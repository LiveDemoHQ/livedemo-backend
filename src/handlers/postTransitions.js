import helpers from '../helpers/livedemoHelpers.js'
import postTransitionValidator from '../helpers/validators/stories/screens/transitions/postTransitionValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'

import ENV from '../envServer.js'
const { STORY_REQUESTS_FOLDER } = ENV
import mongoose from 'mongoose';
import logger from '../helpers/logger.js'

const { ObjectId } = mongoose.Types;

const handler = function (req, res) {
  let {Models, conn} = req.mongo

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

      let validatedBody = helpers.validateBody(req.body, postTransitionValidator)
      requestBody = validatedBody.value

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(() => {
      const selector = requestBody.pointer && requestBody.pointer.selector
      const gotoType = requestBody.gotoType
      const gotoWebsite = requestBody.gotoWebsite
      const gotoScreen = requestBody.gotoScreen

      const frameX = requestBody.hotspot.frameX
      const frameY = requestBody.hotspot.frameY
      const type = requestBody.type
      const content = requestBody.content

      let transitionId = new ObjectId()

      let newTransition = new Models.ScreenTransition({
        _id: transitionId,
        type: type,
        pointer: {
          selector: selector,
        },
        hotspot: {
          frameX: frameX,
          frameY: frameY,
        },
        gotoType: gotoType,
        gotoWebsite: gotoWebsite,
        gotoScreen: gotoScreen,
        content: content,
      })

      return Models.Screen.findOneAndUpdate({ _id: screenId }, { $push: { customTransitions: newTransition } }, { new: true })
        .then((res) => {


          return Models.Screen.findOne({ _id: screenId, 'customTransitions._id': newTransition._id })
            .populate('customTransitions.gotoScreen', 'name _id')
            .lean()
            .then((screenDoc) => {
              return screenDoc.customTransitions.find(nav => nav._id.toString() === newTransition._id.toString())
            })
        })
    })
    .then((newNavDoc) => {

      if (!newNavDoc) {
        throw new Error('Transition couldn\'t be created')
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
        body: JSON.stringify(newNavDoc)
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body)

    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_TRANSITIONS_FAILED' })

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
