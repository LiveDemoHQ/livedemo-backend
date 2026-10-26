import helpers from '../helpers/livedemoHelpers.js'
import postCustomVariablesValidator from '../helpers/validators/stories/custom/postCustomVariablesValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import mongoose from 'mongoose';
import logger from '../helpers/logger.js'

const { ObjectId } = mongoose.Types;

const handler = function (req, res) {
    let {Models, conn} = req.mongo

    let workspaceId = req.params.workspaceId
    let storyId = req.params.storyId
    let requestBody = null
    let authUserDoc = null

    return Promise.resolve().then(async () => {

        return helpers.authReq(req, Models)
    })
        .then(({authUser}) => {
            authUserDoc = authUser
            let validatedBody = helpers.validateBody(req.body, postCustomVariablesValidator)
            requestBody = validatedBody.value

            helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
        })
        .then(async () => {
            let newVariableId = new ObjectId()
            let varName = requestBody.name
            let varValue = requestBody.value

            return Models.Story.findOneAndUpdate({
                _id: storyId
            }, {
                $push: {
                    'custom.variables': {
                        _id: newVariableId,
                        name: varName,
                        value: varValue
                    }
                }
            }, {new: true})
                .then((updatedDoc) => {
                    return {
                        updatedDoc,
                        newVariableId
                    }
                })
        })
        .then(({updatedDoc, newVariableId}) => {

                logger.info(`New default variable added to StoryId - ${updatedDoc._id.toString()} - var - ${newVariableId}`, { eventName: 'POST_CUSTOM_VARIABLES' })
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
                res.send(JSON.stringify(updatedDoc.custom.variables))
            }
        )
        .catch((error) => {
            logger.error(error, { eventName: 'POST_CUSTOM_VARIABLES_FAILED' })

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
