import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'

const FIELDS_BY_TYPE = {
  pages: '_id name index imageUrl recordingRole baseScreenId type createdAt updatedAt',
  screenshots: '_id name index imageUrl createdAt updatedAt',
  videos: '_id name index asset.playback_ids createdAt updatedAt'
}

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let workspaceId = req.params.workspaceId
  let authUserDoc = null

  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(async () => {
      const foundWorkspace = await Models.Workspace.findOne({
        _id: workspaceId,
      }).select('library').lean()

      if (!foundWorkspace) {
        const error = new Error('Workspace not found')
        error.resultResponse = {
          statusCode: ResponseCodes['404_NOT_FOUND'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
            'Access-Control-Allow-Credentials': true,
          },
          body: JSON.stringify({ message: 'Workspace not found' }),
        }
        throw error
      }

      const type = FIELDS_BY_TYPE[req.query.type] ? req.query.type : 'screenshots'
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100)

      // Pages: all Screen_Pages in the workspace (incl. rrweb base/delta). Screenshots/videos: ids kept on the workspace.
      const filter = type === 'pages'
        ? { workspaceId, type: 'Screen_Page' }
        : { _id: { $in: (foundWorkspace.library || {})[type] || [] } }

      const [items, total] = await Promise.all([
        Models.Screen.find(filter)
          .select(FIELDS_BY_TYPE[type])
          .sort({ updatedAt: -1, _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Models.Screen.countDocuments(filter)
      ])

      return { items, total }
    })
    .then((libraryObj) => {
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
      res.send(JSON.stringify(libraryObj))
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

export default  handler

