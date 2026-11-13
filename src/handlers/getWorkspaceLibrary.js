import mongoose from 'mongoose'
import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'

import logger from '../helpers/logger.js'

const { ObjectId } = mongoose.Types

const FIELDS_BY_TYPE = {
  pages: '_id name index imageUrl recordingRole baseScreenId type createdAt updatedAt',
  screenshots: '_id name index imageUrl createdAt updatedAt',
  videos: '_id name index asset.playback_ids createdAt updatedAt'
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toObjectId(value) {
  const str = String(value || '')
  if (!ObjectId.isValid(str)) return null
  return new ObjectId(str)
}

function fieldProjection(fields) {
  return fields.split(' ').reduce((project, field) => {
    if (field) project[field] = 1
    return project
  }, {})
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
      const ids = ((foundWorkspace.library || {})[type] || []).map(toObjectId).filter(Boolean)
      const filter = type === 'pages'
        ? { workspaceId: toObjectId(workspaceId) || workspaceId, type: 'Screen_Page' }
        : { _id: { $in: ids } }

      // ponytail: case-insensitive name regex, no text index. Fine while a workspace
      // library stays in the hundreds; add a text index if this shows up in slow logs.
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : ''
      if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' }

      // Newest first, using the same date the card shows: updatedAt, else createdAt, else the id time.
      const [items, total] = await Promise.all([
        Models.Screen.aggregate([
          { $match: filter },
          {
            $addFields: {
              recentAt: {
                $ifNull: ['$updatedAt', { $ifNull: ['$createdAt', { $toDate: '$_id' }] }]
              }
            }
          },
          { $sort: { recentAt: -1, _id: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          { $project: fieldProjection(FIELDS_BY_TYPE[type]) }
        ]),
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
      logger.error(error, { eventName: 'GET_WORKSPACE_LIBRARY_FAILED' })

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

