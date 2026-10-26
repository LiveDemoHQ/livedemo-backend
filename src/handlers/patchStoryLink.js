import helpers from '../helpers/livedemoHelpers.js'
import patchStoryLinkValidator from '../helpers/validators/stories/links/patchStoryLinkValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import mongoose from 'mongoose';
import logger from '../helpers/logger.js'

const { ObjectId } = mongoose.Types;

const handler = function (req, res) {
    let {Models, conn} = req.mongo

    let workspaceId = req.params.workspaceId
    let storyId = req.params.storyId
    let linkId = req.params.linkId
    let requestBody = null
    let authUserDoc = null

    return Promise.resolve().then(async () => {

        return helpers.authReq(req, Models)
    })
        .then(({authUser}) => {
            authUserDoc = authUser
            let validatedBody = helpers.validateBody(req.body, patchStoryLinkValidator)
            requestBody = validatedBody.value

            helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
        })
        .then(() => {
            return Models.Story.findOne({_id: storyId}).lean()
        })
        .then(async (storyDoc) => {
            let newName = requestBody.name ?? ""
            let newVariables = requestBody.variables ?? ""

            const updateOperations = {};
            newVariables.forEach((variable, index) => {
                updateOperations[`variables.${index}.name`] = variable.name;
                updateOperations[`variables.${index}.value`] = variable.value;
            });

            return Models.Link.findOneAndUpdate({
                _id: linkId,
            }, {
                $set: {
                    'name': newName,
                    ...updateOperations
                }
            }, {new: true})
        })
        .then((newLinkDoc) => {

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
                res.send(JSON.stringify(newLinkDoc))
            }
        )
        .catch((error) => {
            logger.error(error, { eventName: 'PATCH_STORY_LINK_FAILED' })

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
