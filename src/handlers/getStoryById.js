import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { getChecklistContext } from '../helpers/checklist/checklist.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let authUserDoc = null

  return Promise.resolve().then(async () => {

    return helpers.authReq(req, Models)
  })
    .then(({ authUser }) => {
      authUserDoc = authUser

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(async () => {

      let storyPromise = Models.Story.findOne({
        _id: storyId,
        workspaceId: workspaceId,
        deletedAt: null
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
              path: 'steps.view.popup.formId',
              model: 'Form',
            },
            {
              path: 'steps.stepAudioId',
              model: 'Audio',
            },
            {
              path: 'steps.view.popup.buttons.gotoScreen',
              model: 'Screen',
            },
            {
              path: 'cursorPositions',
              model: 'CursorPositions',
            }
          ],
          select: '_id name type screens steps customTransitions width height imageUrl index asset playbackRate popups zoomSpans zoomSpan startTime endTime cursorPositions recordingRole baseScreenId fromTimeMs toTimeMs eventCount sandboxLinks sandboxHidden sandboxDuplicateOf',
        })
        .populate('content.contentId')

      let cursorPositionsPromise = Models.CursorPositions.find({ storyId }).lean()

      return Promise.all([storyPromise, cursorPositionsPromise])
    })
    .then(async ([foundStory, cursorPositions]) => {
      let responsePayload = foundStory ? (foundStory.toObject ? foundStory.toObject() : foundStory) : null;
      if (responsePayload) {
        if (Array.isArray(responsePayload.screens)) {
          responsePayload.screens.sort((a, b) => a.index - b.index)
        }
        responsePayload.cursorPositions = cursorPositions;
        // Editor preview: checklist renders live from the config, nothing is persisted
        responsePayload.checklistContext = await getChecklistContext(Models, responsePayload, { isEditor: true })
      }

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
      res.send(JSON.stringify(responsePayload))
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

export default handler

