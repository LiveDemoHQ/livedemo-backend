import helpers from '../helpers/livedemoHelpers.js'
import aiHelpers from '../helpers/aiHelpers.js'
import postStoryAITextValidator from '../helpers/validators/stories/postStoryAIText.js'
import ResponseCodes from '../constants/ResponseCodes.js'

import ENV from '../envServer.js'
import mongoose from 'mongoose';
const { ObjectId } = mongoose.Types;
import livedemoHelpers from "../helpers/livedemoHelpers.js";

import logger from '../helpers/logger.js'

const {STORY_REQUESTS_FOLDER} = ENV


const handler = function (req, res) {
    let {Models, conn} = req.mongo

    let requestBody = null

    let workspaceId = req.params.workspaceId
    let storyId = req.params.storyId
    let authUserDoc = null

    return Promise.resolve().then(async () => {

        return helpers.authReq(req, Models)
    })
        .then(({authUser}) => {
            authUserDoc = authUser

            let validatedBody = helpers.validateBody(req.body, postStoryAITextValidator)
            requestBody = validatedBody.value

            helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
        })
        .then(() => {

            return Models.Screen.find(
                {
                    storyId: new ObjectId(storyId),
                    $or: [{steps: {$elemMatch: {"view.viewType": 'hotspot'}}}, {steps: {$elemMatch: {"view.viewType": 'tooltip'}}}]
                })
                .lean()
        })
        .then((screenDocs) => {
            return Models.Story.findOne({_id: storyId}).lean()
                .then((storyDoc) => {
                    return {
                        screenDocs,
                        storyDoc,
                    }
                })
        })
        .then(({screenDocs, storyDoc}) => {
            storyDoc = livedemoHelpers.processLiveDemoLinkUpdates({screens: screenDocs}, {variables: storyDoc.custom.variables || []})

            screenDocs = storyDoc.screens

            let stepsByScreenArray = screenDocs.reduce((accum, screen) => {
                screen.steps.forEach(step => {
                    let stepObj = step
                    stepObj.screenId = screen._id

                    accum.push(stepObj)
                })

                return accum
            }, [])

            let stepsText = stepsByScreenArray.map((step, index) => `${++index}. ${step.view.content}`).join('\n')
            let prompt = `Given the following steps:
${stepsText}

Rephrase them to be numbered, consequential and coherent like a  guide `

            return aiHelpers.query3_5(prompt)
                .then((answerText) => {
                    let answerLines = answerText.split('\n')
                    let answerLinesNumbered = []

                    for (let i = 0; i < answerLines.length; i++) {
                        if (answerLines[i].match(/^\d\./)) {
                            answerLinesNumbered.push(answerLines[i])
                        }
                    }

                    for (let i = 0; i < answerLinesNumbered.length; i++) {
                        let answerText = answerLinesNumbered[i].slice(3)
                        if (answerText[answerText.length - 1] === '.') {
                            answerText = answerText.slice(0, answerText.length - 1)
                        }

                        stepsByScreenArray[i].answerText = answerText
                    }

                    return stepsByScreenArray
                })
        })
        .then((stepsByScreenArray) => {
            logger.info(stepsByScreenArray, { eventName: 'POST_STORY_AITEXT' })

            let updateOps = []
            stepsByScreenArray.forEach((step) => {

                if (step.answerText) {

                    updateOps.push({
                        updateOne: {
                            filter: {
                                _id: new ObjectId(step.screenId),
                                "steps": {$elemMatch: {_id: new ObjectId(step._id)}}
                            },
                            update: {
                                $set: {
                                    "steps.$.view.content": `<p>${step.answerText}</p>`
                                }
                            }
                        }
                    })
                }

            })


            return Models.Screen.bulkWrite(updateOps)
        })
        .then(result => {
            logger.info(result, { eventName: 'POST_STORY_AITEXT' })
        })
        .then(() => {

            const resultResponse = {
                statusCode: ResponseCodes['200_OK'],
                headers: {
                    'Access-Control-Max-Age': 600,
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
                    // Required for CORS support to work
                    'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
                },
                body: JSON.stringify({
                    success: true
                })
            }

            res.set(resultResponse.headers)
            res.status(resultResponse.statusCode)
            res.send(resultResponse.body)
        })
        .catch((error) => {
            logger.error(error, { eventName: 'POST_STORY_AITEXT_FAILED' })

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
