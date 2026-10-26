import helpers from '../helpers/livedemoHelpers.js'
import postScreenEditTextValidator from '../helpers/validators/stories/screens/postScreenEditTextValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { editRrwebScreenNode } from '../helpers/editRrwebScreenText.js'
import short from 'short-uuid'
import ENV from '../envServer.js'

import logger from '../helpers/logger.js'

function extFromMime(mime) {
  if (mime === 'image/jpeg') return '.jpg'
  if (mime === 'image/gif') return '.gif'
  if (mime === 'image/webp') return '.webp'
  if (mime === 'image/svg+xml') return '.svg'
  return '.png'
}

async function uploadEditImage(imageData) {
  const mimeMatch = String(imageData).match(/^data:([^;]+);base64,/)
  const mime = mimeMatch ? mimeMatch[1] : 'image/png'
  if (!String(mime).startsWith('image/')) {
    const error = new Error('Only images are allowed')
    error.resultResponse = {
      statusCode: ResponseCodes['400_BAD_REQUEST'],
      headers: {
        'Access-Control-Max-Age': 600,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify({ message: 'Only images are allowed' }),
    }
    throw error
  }
  const raw = String(imageData).replace(/^data:[^;]+;base64,/, '')
  const buf = Buffer.from(raw, 'base64')
  if (buf.length > 5 * 1024 * 1024) {
    const error = new Error('Image too large')
    error.resultResponse = {
      statusCode: ResponseCodes['400_BAD_REQUEST'],
      headers: {
        'Access-Control-Max-Age': 600,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify({ message: 'Image too large' }),
    }
    throw error
  }
  const imageName = short.uuid() + extFromMime(mime)
  const uploadResult = await helpers.uploadBufferImage(buf, mime, imageName)
  if (uploadResult && uploadResult.Location) {
    return uploadResult.Location
  }
  const cdn = String(ENV.LIVEDEMO_CDN_URL || '').replace(/\/$/, '')
  if (cdn) {
    return `${cdn}/story-images/${imageName}`
  }
  if (uploadResult && uploadResult.Key) {
    return `https://livedemo-cdn.s3.amazonaws.com/${uploadResult.Key}`
  }
  return `https://livedemo-cdn.s3.amazonaws.com/story-images/${imageName}`
}

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

      let validatedBody = helpers.validateBody(req.body, postScreenEditTextValidator)
      requestBody = validatedBody.value

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(async () => {


      return Models.Screen.findOne({
        _id: screenId
      }).lean()
    })
    .then(async (screenDoc) => {
      if (!screenDoc) {
        const error = new Error('Screen not found')
        error.resultResponse = {
          statusCode: ResponseCodes['404_NOT_FOUND'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
            'Access-Control-Allow-Credentials': true,
          },
          body: JSON.stringify({ message: 'Screen not found' }),
        }
        throw error
      }

      // Legacy static HTML PageScreens are no longer editable / captured.
      // Only rrweb DOM screens (recordingRole) support Edit Text.
      if (!screenDoc.recordingRole) {
        const error = new Error('EditText is only supported for DOM (rrweb) screens')
        error.resultResponse = {
          statusCode: ResponseCodes['400_BAD_REQUEST'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
            'Access-Control-Allow-Credentials': true,
          },
          body: JSON.stringify({ message: 'EditText is only supported for DOM (rrweb) screens' }),
        }
        throw error
      }

      const nodeId = parseInt(requestBody.selector, 10)
      if (!Number.isFinite(nodeId)) {
        const error = new Error('Invalid rrweb node id')
        error.resultResponse = {
          statusCode: ResponseCodes['400_BAD_REQUEST'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
            'Access-Control-Allow-Credentials': true,
          },
          body: JSON.stringify({ message: 'Invalid rrweb node id' }),
        }
        throw error
      }

      const imageData = requestBody.imageData || (req.body && req.body.imageData) || ''
      const hasStyle = requestBody.color != null || requestBody.backgroundColor != null || requestBody.hidden != null || requestBody.blurred != null
      const hasImage = typeof imageData === 'string' && imageData.indexOf('data:') === 0
      const hasText = requestBody.text != null
      const parsedTextNodeId = requestBody.textNodeId != null ? parseInt(requestBody.textNodeId, 10) : null
      const parsedElementNodeId = requestBody.elementNodeId != null ? parseInt(requestBody.elementNodeId, 10) : null

      // Old clients send selector = text-node id and only `text`.
      if (hasText && !hasStyle && !hasImage && requestBody.textNodeId == null && requestBody.elementNodeId == null) {
        return editRrwebScreenNode({
          Models,
          screenDoc,
          nodeId,
          textNodeId: nodeId,
          text: requestBody.text,
        })
      }

      const styleUpdates = {}
      if (requestBody.color != null) {
        styleUpdates.color = requestBody.color
      }
      if (requestBody.backgroundColor != null) {
        styleUpdates['background-color'] = requestBody.backgroundColor
      }
      if (requestBody.hidden === true) {
        styleUpdates.visibility = 'hidden'
      }
      if (requestBody.hidden === false) {
        styleUpdates.visibility = ''
      }
      if (requestBody.blurred === true) {
        styleUpdates.filter = 'blur(8px)'
      }
      if (requestBody.blurred === false) {
        styleUpdates.filter = ''
      }

      const attributes = {}
      if (hasImage) {
        const imageUrl = await uploadEditImage(imageData)
        const kind = requestBody.imageKind || 'src'
        if (kind === 'background') {
          styleUpdates['background-image'] = `url("${imageUrl}")`
        } else if (kind === 'href') {
          attributes.href = imageUrl
          attributes['xlink:href'] = imageUrl
        } else {
          attributes.src = imageUrl
          attributes.srcset = ''
          // Replay consumes rr_dataURL as the visible src. Point it at the new file
          // on deltas; base snapshots drop it in applyAttrsToSnapshot.
          attributes.rr_dataURL = imageUrl
        }
      }

      return editRrwebScreenNode({
        Models,
        screenDoc,
        nodeId,
        elementNodeId: Number.isFinite(parsedElementNodeId) ? parsedElementNodeId : nodeId,
        textNodeId: Number.isFinite(parsedTextNodeId) ? parsedTextNodeId : null,
        text: hasText ? requestBody.text : undefined,
        attributes: Object.keys(attributes).length ? attributes : null,
        styleUpdates: Object.keys(styleUpdates).length ? styleUpdates : null,
      })
    })
    .then(() => {

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
      res.send(JSON.stringify({}))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_SCREEN_EDIT_TEXT_FAILED' })

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
