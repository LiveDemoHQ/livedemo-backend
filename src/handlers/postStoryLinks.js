import helpers from '../helpers/livedemoHelpers.js'
import postStoryLinksValidator from '../helpers/validators/stories/postStoryLinksValidator.js'
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
            let validatedBody = helpers.validateBody(req.body, postStoryLinksValidator)
            requestBody = validatedBody.value

            helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
        })
        .then(() => {
            return Models.Story.findOne({ _id: storyId }).lean()
        })
        .then(async (storyDoc) => {
            let linkName = requestBody.name ? requestBody.name : `${authUserDoc.name.split(' ')[0]}'s link`
            let defaultVariables = storyDoc.custom.variables && storyDoc.custom.variables.length > 0 ? storyDoc.custom.variables : []
            // Clear default values, keep only their names
            defaultVariables = defaultVariables.map(varItem => {
                return {
                    _id: new ObjectId(),
                    name: varItem.name,
                    value: varItem.value
                }
            })

            return new Models.Link({
                name: linkName,
                storyId: storyId,
                workspaceId: workspaceId,
                variables: defaultVariables
            })
                .save()
                .then((newLinkDoc) => {
                    return Models.Story.findOneAndUpdate({
                            _id: storyId
                        }, {
                            $push: {
                                'links': newLinkDoc._id.toString()
                            }
                        }, {new: true}
                    )
                        .then((updatedDoc) => {

                            return newLinkDoc
                        })
                })
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
            logger.error(error, { eventName: 'POST_STORY_LINKS_FAILED' })

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
