import helpers from '../helpers/livedemoHelpers.js'
import postStepValidator from '../helpers/validators/stories/screens/steps/postStepValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import StepViewTypes from '../constants/StepViewTypes.js'
import ScreenPopupTypes from '../constants/ScreenPopupTypes.js'
import demoStepLimit from '../helpers/demoStepLimit.js'
import mongoose from 'mongoose'

const { ObjectId } = mongoose.Types

const handler = function (req, res) {
    let { Models, conn } = req.mongo

    let requestBody = null

    let workspaceId = req.params.workspaceId
    let storyId = req.params.storyId
    let screenId = req.params.screenId
    let authUserDoc = null

    return Promise.resolve().then(async () => {

        return helpers.authReq(req, Models)
    })
        .then(({ authUser }) => {
            authUserDoc = authUser

            let validatedBody = helpers.validateBody(req.body, postStepValidator)
            requestBody = validatedBody.value

            helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
        })
        .then(() => {

            // Find all screens in the current workspace and story, ordered by index ascending
            return Models.Screen.find({
                storyId: storyId,
                // workspaceId: workspaceId
            })
                .sort({ index: 1 })
                .then((screens) => {
                    let currentScreen = screens.find(s => s._id.toString() === screenId.toString());
                    let nextScreen = screens[currentScreen.index + 1] || currentScreen
                    demoStepLimit.assertCanAddStep(screens, screenId)
                    return { screens, nextScreen };
                })
        })
        .then(({ screens, nextScreen }) => {
            let stepIndex = requestBody.index
            let viewType = requestBody.view && requestBody.view.viewType

            // Handle if viewType is Popup to add default Popup config
            let additionalConfigForPopup = {
                popup: {
                    type: 'popup',
                    title: 'Title',
                    description: '<p>Description</p>',
                    alignment: 'center',
                    showOverlay: true,
                    buttons: [
                        {
                            index: 0,
                            text: 'Get Started',
                            gotoType: 'next',
                            gotoScreen: nextScreen._id,
                        }
                    ]
                }
            }

            let additionalConfig = {}
            if(viewType === StepViewTypes.POPUP) {
                additionalConfig = additionalConfigForPopup
            }

            let newStep = new Models.ScreenStep({
                index: stepIndex,
                view: {
                    viewType: StepViewTypes[viewType.toUpperCase()],
                    content: '<p>New step</p>',

                    ...additionalConfig
                }})

            return Models.Screen.findOneAndUpdate({ _id: screenId }, { $push: { steps: newStep } }, { new: true })
                .then(() => {
                    return newStep
                })
        })
        .then((newStepDoc) => {

            if (!newStepDoc) {
                throw new Error('Step couldn\'t be created')
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
                body: JSON.stringify(newStepDoc)
            }

            res.set(resultResponse.headers)
            res.status(resultResponse.statusCode)
            res.send(resultResponse.body)

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
