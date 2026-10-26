import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import ScreenTypes from '../constants/ScreenTypes.js'
import postCreateScreenFromFrameValidator from '../helpers/validators/stories/screens/postCreateScreenFromFrameValidator.js'
import short from 'short-uuid'
import axios from 'axios'
import mongoose from 'mongoose'

import logger from '../helpers/logger.js'

const { ObjectId } = mongoose.Types

function badRequest(message) {
  const resultResponse = {
    statusCode: ResponseCodes['400_BAD_REQUEST'],
    headers: {
      'Access-Control-Max-Age': 600,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
      'Access-Control-Allow-Credentials': true,
    },
    body: JSON.stringify({ error: message }),
  }
  const error = new Error(message)
  error.resultResponse = resultResponse
  throw error
}

function notFound(message) {
  const resultResponse = {
    statusCode: ResponseCodes['404_NOT_FOUND'],
    headers: {
      'Access-Control-Max-Age': 600,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
      'Access-Control-Allow-Credentials': true,
    },
    body: JSON.stringify({ error: message }),
  }
  const error = new Error(message)
  error.resultResponse = resultResponse
  throw error
}

const handler = function (req, res) {
  let { Models } = req.mongo

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let screenId = req.params.screenId
  let authUserDoc = null
  let time = null

  return Promise.resolve()
    .then(async () => helpers.authReq(req, Models))
    .then(({ authUser }) => {
      authUserDoc = authUser
      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(() => {
      const validatedBody = helpers.validateBody(req.body, postCreateScreenFromFrameValidator)
      time = validatedBody.value.time
    })
    .then(async () => {
      const storyDoc = await Models.Story.findOne({ _id: storyId, workspaceId }).lean()
      if (!storyDoc) {
        notFound('Story not found')
      }
      const screenInStory = storyDoc.screens.some((id) => id.toString() === screenId)
      if (!screenInStory) {
        notFound('Screen not found in story')
      }

      const videoScreenDoc = await Models.Screen.findOne({ _id: screenId }).lean()
      if (!videoScreenDoc) {
        notFound('Screen not found')
      }
      if (videoScreenDoc.type !== ScreenTypes.SCREEN_VIDEO) {
        badRequest('Screen must be a video screen')
      }

      const playbackId = videoScreenDoc.asset?.playback_ids?.[0]?.id
      if (!playbackId) {
        badRequest('Video screen has no playback id yet')
      }

      const thumbnailUrl = `https://image.mux.com/${playbackId}/thumbnail.png?time=${encodeURIComponent(time)}`
      let thumbRes
      try {
        thumbRes = await axios.get(thumbnailUrl, {
          responseType: 'arraybuffer',
          timeout: 60000,
        })
      } catch (e) {
        logger.error(e, { eventName: 'POST_CREATE_SCREEN_FROM_FRAME_FAILED' })
        badRequest('Could not fetch frame thumbnail from Mux')
      }

      const imageBuffer = Buffer.from(thumbRes.data)
      const imageName = short.uuid() + '.png'
      const uploadResult = await helpers.uploadBufferImage(imageBuffer, 'image/png', imageName)
      const imageUrl = uploadResult.Location

      const nextIndex = videoScreenDoc.index + 1

      await Models.Screen.updateMany(
        { storyId, index: { $gte: nextIndex } },
        { $inc: { index: 1 } },
      )

      const newScreenId = new ObjectId()

      const newScreenDoc = await new Models.Screen_Screenshot({
        _id: newScreenId,
        imageUrl,
        customTransitions: [],
        storyId,
        index: nextIndex,
        workspaceId,
        userId: authUserDoc.id,
        type: ScreenTypes.SCREEN_SCREENSHOT,
      }).save()

      await Models.Story.findOneAndUpdate({ _id: storyId }, {
        $push: { screens: newScreenId },
      })

      await Models.Workspace.findOneAndUpdate({ _id: workspaceId }, {
        $addToSet: { 'library.screenshots': newScreenId },
      })

      return newScreenDoc
    })
    .then((screenDoc) => {
      const resultResponse = {
        statusCode: ResponseCodes['200_OK'],
        headers: {
          'Access-Control-Max-Age': 600,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
          'Access-Control-Allow-Credentials': true,
        },
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(JSON.stringify(screenDoc))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_CREATE_SCREEN_FROM_FRAME_FAILED' })

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
          body: '',
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body !== undefined ? resultResponse.body : '')
    })
}

export default handler
