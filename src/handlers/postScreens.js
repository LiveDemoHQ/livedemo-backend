import postScreensValidator from '../helpers/validators/stories/screens/postScreensValidator.js'
import helpers from '../helpers/livedemoHelpers.js'
import short from 'short-uuid'
import ResponseCodes from '../constants/ResponseCodes.js'
import mongoose from 'mongoose';
const { ObjectId } = mongoose.Types;
import ENV from '../envServer.js'
import fsp from 'fs/promises'

import * as parse5 from 'parse5'
import { httpError } from '../helpers/rrwebScreenGuards.js'
import { stringifyRrwebEvents } from '../helpers/rrwebEventNames.js'

import logger from '../helpers/logger.js'

const SCREENDOC_ENCODING = 'utf-8'
const RRWEB_FULL_SNAPSHOT = 2

function handler(req, res){
  let {Models, conn} = req.mongo

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let requestBody = req.body
  let authUserDoc = null

  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser
      let validatedBody = helpers.validateBody(req.body, postScreensValidator)
      requestBody = validatedBody.value

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(async () => {
      if (requestBody.recordingRole) {
        return createRrwebScreen({ Models, requestBody, workspaceId, storyId, authUserDoc })
      }
      // Legacy static HTML PageScreens: create only in local/dev. Prod = rrweb DOM only.
      // Screenshot/video Flix capture does not use this handler.
      if (ENV.ENV === 'dev') {
        return createLegacyHtmlScreen({ Models, requestBody, workspaceId, storyId, authUserDoc })
      }
      httpError(ResponseCodes['400_BAD_REQUEST'], 'Legacy HTML page screens are disabled; use DOM (rrweb) recording')
    })
    .then((newScreen) => {
      return Models.Story.findOneAndUpdate({ _id: storyId }, {
          $push: {
            screens: newScreen._id
          }
        })
        .then(() => {
          return Models.Workspace.findOneAndUpdate({ _id: workspaceId }, {
            $addToSet: {
              'library.pages': newScreen._id,
            }
          })
        })
        .then(() => newScreen)
    })
    .then((newScreen) => {

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
      res.send(JSON.stringify(newScreen))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_SCREENS_FAILED' })

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

async function ensureStoryDir(storyId) {
  const storyDir = `${ENV.STORIES_FOLDER}/${storyId}`
  try {
    await fsp.access(storyDir)
  } catch {
    await fsp.mkdir(storyDir, { recursive: true })
  }
  return storyDir
}

async function createRrwebScreen({ Models, requestBody, workspaceId, storyId, authUserDoc }) {
  const {
    name,
    recordingRole,
    baseScreenId,
    events,
    fromTimeMs,
    toTimeMs,
    imageData,
    width,
    height,
  } = requestBody

  if (!Array.isArray(events) || events.length === 0) {
    httpError(ResponseCodes['400_BAD_REQUEST'], 'events must be a non-empty array')
  }

  if (recordingRole === 'base') {
    const fullSnapshots = events.filter((e) => e && e.type === RRWEB_FULL_SNAPSHOT)
    if (fullSnapshots.length !== 1) {
      httpError(
        ResponseCodes['400_BAD_REQUEST'],
        'base screen events must contain exactly one FullSnapshot (type 2)'
      )
    }
  }

  if (recordingRole === 'delta') {
    const baseDoc = await Models.Screen.findOne({ _id: baseScreenId, storyId }).lean()
    if (!baseDoc) {
      httpError(ResponseCodes['404_NOT_FOUND'], 'baseScreenId not found in this story')
    }
    if (baseDoc.recordingRole !== 'base') {
      httpError(ResponseCodes['400_BAD_REQUEST'], 'baseScreenId must reference a base Screen_Page')
    }
  }

  const screenId = new ObjectId()
  const storyDir = await ensureStoryDir(storyId)
  const fileName = recordingRole === 'base'
    ? `${screenId}.rrweb.json`
    : `${screenId}.events.json`
  const filePath = `${storyDir}/${fileName}`

  let imageUrl = ''
  if (imageData) {
    const imageName = short.uuid() + '.png'
    const uploadResult = await helpers.uploadImage(imageData, imageName)
    imageUrl = uploadResult.Location
  }

  await helpers.writeToSystem(filePath, stringifyRrwebEvents(events), SCREENDOC_ENCODING)

  const storyDoc = await Models.Story.findOne({ _id: storyId }).lean()
  const screensLength = storyDoc.screens.length

  const screenObj = {
    _id: screenId,
    name,
    workspaceId,
    userId: authUserDoc._id,
    storyId,
    width,
    height,
    imageUrl,
    index: screensLength,
    recordingRole,
    eventCount: events.length,
    fromTimeMs,
    toTimeMs,
  }

  if (recordingRole === 'base') {
    screenObj.snapshotPath = filePath
  } else {
    screenObj.eventsPath = filePath
    screenObj.baseScreenId = baseScreenId
  }

  const newStep = new Models.Step({
    view: {
      content: '<p>Welcome to our StoryDemo!</p>'
    }
  })
  screenObj.steps = [newStep]

  return new Models.Screen_Page(screenObj).save()
}

async function createLegacyHtmlScreen({ Models, requestBody, workspaceId, storyId, authUserDoc }) {
  let name = requestBody.name
  let width = requestBody.width
  let height = requestBody.height
  let content = requestBody.content
  let imageData = requestBody.imageData
  let screenId = new ObjectId()

  let storyDir = `${ENV.STORIES_FOLDER}/${storyId}`
  let screenDir = `${storyDir}/${screenId}.html`

  let imageUrl = ''
  let imageName = short.uuid() + '.png'

  const uploadResult = await helpers.uploadImage(imageData, imageName)
  imageUrl = uploadResult.Location

  try {
    await fsp.access(storyDir)
  } catch {
    await fsp.mkdir(storyDir)
  }

  const document = parse5.parse(content)
  const documentString = parse5.serialize(document)
  await helpers.writeToSystem(screenDir, documentString, SCREENDOC_ENCODING)

  const storyDoc = await Models.Story.findOne({ _id: storyId }).lean()
  let screensLength = storyDoc.screens.length

  let screenObj = {
    _id: screenId,
    name,
    workspaceId,
    userId: authUserDoc._id,
    storyId: storyId,
    contentPath: screenDir,
    width: width,
    height: height,
    imageUrl: imageUrl,
    index: screensLength
  }

  let newStep = new Models.Step({
    view: {
      content: '<p>Welcome to our StoryDemo!</p>'
    }
  })
  screenObj.steps = [newStep]

  return new Models.Screen_Page(screenObj).save()
}


export default  handler
