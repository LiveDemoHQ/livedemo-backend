import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import ScreenTypes from "../constants/ScreenTypes.js";

import logger from '../helpers/logger.js'

const handler = function (req, res) {
    let {Models, conn} = req.mongo


    let requestBody = null

    let workspaceId = req.params.workspaceId
    // let storyId = req.params.storyId
    // let screenId = req.params.screenId
    // let stepId = req.params.stepId
    let screenId = req.params.screenId
    let zoomSpanId = req.params.zoomSpanId
    let authUserDoc = null

    return Promise.resolve().then(async () => {

        return helpers.authReq(req, Models)
    })
        .then(({authUser}) => {
            authUserDoc = authUser

            helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
        })
        .then(() => {
            return Models.Screen.findById(screenId)
        })
        .then((screenDoc) => {

          if(screenDoc.type === ScreenTypes.SCREEN_VIDEO) {

            return Models.Screen_Video.findOneAndUpdate({_id: screenId}, {
              $pull: {
                zoomSpans: {_id: zoomSpanId}
              }
            }, {new: true})
          } else {

            return Models.Screen_Screenshot.findOneAndUpdate({_id: screenId}, {
              $set: {
                zoomSpan: null
              }
            }, {new: true})
          }
        })
        .then((screenDoc) => {

            if (!screenDoc) {
                throw new Error('ZoomSpan couldn\'t be deleted')
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
                body: JSON.stringify(screenDoc)
            }

            res.set(resultResponse.headers)
            res.status(resultResponse.statusCode)
            res.send(resultResponse.body)

        })
        .catch((error) => {
            logger.error(error, { eventName: 'DELETE_ZOOM_SPAN_FAILED' })

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
