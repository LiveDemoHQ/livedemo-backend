import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { cloneStoryDemo } from '../helpers/cloneStoryDemo.js'

const CORS_HEADERS = {
  'Access-Control-Max-Age': 600,
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
  'Access-Control-Allow-Credentials': true,
}

const handler = function (req, res) {
  const { Models } = req.mongo
  const workspaceId = req.params.workspaceId
  const storyId = req.params.storyId
  const targetWorkspaceId = String(req.body?.workspaceId || workspaceId)

  return Promise.resolve()
    .then(() => helpers.authReq(req, Models))
    .then(({ authUser }) => {
      helpers.validateUserHasAccessToWorkspace(authUser, workspaceId)
      helpers.validateUserHasAccessToWorkspace(authUser, targetWorkspaceId)
      return authUser
    })
    .then(async (authUser) => {
      const sourceStory = await Models.Story.findOne({
        _id: storyId,
        workspaceId,
        deletedAt: null,
      }).lean()

      if (!sourceStory) {
        const error = new Error('Story not found')
        error.resultResponse = {
          statusCode: ResponseCodes['404_NOT_FOUND'],
          headers: CORS_HEADERS,
          body: JSON.stringify({ message: 'Story not found' }),
        }
        throw error
      }

      const newStoryId = await cloneStoryDemo(
        storyId,
        authUser._id,
        targetWorkspaceId,
        Models,
        { nameSuffix: targetWorkspaceId === workspaceId ? ' (2)' : '' }
      )

      if (!newStoryId) {
        const error = new Error('Failed to clone story')
        error.resultResponse = {
          statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
          headers: CORS_HEADERS,
          body: JSON.stringify({ message: 'Failed to clone story' }),
        }
        throw error
      }

      const clonedStory = await Models.Story.findById(newStoryId)
        .populate({ path: 'screens', select: '_id type imageUrl' })
        .lean()

      return clonedStory
    })
    .then((clonedStory) => {
      res.set(CORS_HEADERS)
      res.status(ResponseCodes['200_OK'])
      res.send(JSON.stringify(clonedStory))
    })
    .catch((error) => {
      console.log(error)

      const resultResponse = error.resultResponse || {
        statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
        headers: CORS_HEADERS,
        body: '',
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body)
    })
}

export default handler
