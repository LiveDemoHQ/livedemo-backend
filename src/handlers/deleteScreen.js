import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { httpError } from '../helpers/rrwebScreenGuards.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let screenId = req.params.screenId
  let authUserDoc = null

  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser
      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(async () => {
      const screenDoc = await Models.Screen.findOne({ _id: screenId }).lean()
      if (!screenDoc) {
        httpError(ResponseCodes['404_NOT_FOUND'], 'Screen not found')
      }

      // Guard: block deleting a base that has linked deltas
      if (screenDoc.recordingRole === 'base') {
        const linkedDelta = await Models.Screen.findOne({
          storyId,
          recordingRole: 'delta',
          baseScreenId: screenId,
        }).lean()
        if (linkedDelta) {
          httpError(
            ResponseCodes['409_CONFLICT'],
            'Cannot delete a base screen that still has linked delta screens'
          )
        }
      }

      // Flix-style: CTA for click into K lives on screen K-1. After deleting K, that
      // hotspot still advances to the new next screen — only scrub the stale copy /
      // element metadata that described the removed click.
      if (screenDoc.recordingRole === 'delta' && screenDoc.baseScreenId) {
        const prevScreen = await Models.Screen.findOne({
          storyId,
          index: { $lt: screenDoc.index },
          $or: [
            { _id: screenDoc.baseScreenId },
            {
              recordingRole: 'delta',
              baseScreenId: screenDoc.baseScreenId,
            },
          ],
        }).sort({ index: -1 })

        if (prevScreen && Array.isArray(prevScreen.steps) && prevScreen.steps.length) {
          let changed = false
          prevScreen.steps.forEach((step) => {
            if (step && step.view && step.view.viewType === 'hotspot') {
              step.view.content = '<p>Click here</p>'
              if (step.elementData) {
                step.elementData.targetHTML = ''
                step.elementData.targetText = ''
                step.elementData.targetElementType = 'element'
              }
              changed = true
            }
          })
          if (changed) {
            prevScreen.markModified('steps')
            await prevScreen.save()
          }
        }
      }

      return Models.Screen.findOneAndDelete({ _id: screenId })
        .then(() => {

          return Models.Story.findOneAndUpdate({ _id: storyId }, {
              $pull: {
                screens: screenId
              }
            }, { new: true })
            // Story.screens is in push order, not display order — reindex from
            // the `index` field, which is what every read path sorts by.
            .then(() => Models.Screen.find({ storyId }).sort({ index: 1 }).select('_id').lean())
            .then(sortedScreens => {
              let updateOps = []
              sortedScreens.forEach((screen, index) => {

                updateOps.push({
                  updateOne: {
                    filter: { _id: screen._id },
                    update: {
                      index: index,
                    }
                  }
                })
              })

              // Empty story after last screen — nothing to reindex
              if (!updateOps.length) {
                return { ok: 1 }
              }

              return Models.Screen.bulkWrite(updateOps)
            })
        })
    })
    .then((updateOpsResult) => {

      if (!updateOpsResult) {
        throw new Error('Screen couldn\'t be deleted')
      }

      const resultResponse = {
        statusCode: ResponseCodes['200_OK'],
        headers: {
          'Access-Control-Max-Age': 600,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
          'Access-Control-Allow-Credentials': true,
        },
        body: JSON.stringify({})
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body)

    })
    .catch((error) => {
      logger.error(error, { eventName: 'DELETE_SCREEN_FAILED' })

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
