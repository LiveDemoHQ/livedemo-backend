import helpers from '../helpers/livedemoHelpers.js'
import postCustomThemeValidator from '../helpers/validators/stories/custom/postCustomThemeValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo


  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let requestBody = null
  let authUserDoc = null

  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser
      let validatedBody = helpers.validateBody(req.body, postCustomThemeValidator)
      requestBody = validatedBody.value

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(async () => {
      let isActive = requestBody.isActive
      let stepBackgroundColor = requestBody.stepBackgroundColor
      let textColor = requestBody.textColor
      let buttonBackgroundColor = requestBody.buttonBackgroundColor
      let buttonTextColor = requestBody.buttonTextColor
      let fontFamily = requestBody.fontFamily || ''
      let fontSize = requestBody.fontSize || 15
      let showTooltipArrow = !!requestBody.showTooltipArrow
      let hoverGlow = requestBody.hoverGlow !== false
      let pulsatingBorderColor = requestBody.pulsatingBorderColor || '#1070ff'
      let footerButtons = requestBody.footerButtons || 'backAndNext'

      let watermarkConfigIsActive = requestBody.watermarkConfig.isActive
      let watermarkConfigText = requestBody.watermarkConfig.text
      let watermarkConfigUrl = requestBody.watermarkConfig.url

      return Models.Story.findOneAndUpdate({
        _id: storyId
      }, {
        $set: {
          'custom.theme.isActive': isActive,
          'custom.theme.stepBackgroundColor': stepBackgroundColor,
          'custom.theme.textColor': textColor,
          'custom.theme.buttonBackgroundColor': buttonBackgroundColor,
          'custom.theme.buttonTextColor': buttonTextColor,
          'custom.theme.fontFamily': fontFamily,
          'custom.theme.fontSize': fontSize,
          'custom.theme.showTooltipArrow': showTooltipArrow,
          'custom.theme.hoverGlow': hoverGlow,
          'custom.theme.pulsatingBorderColor': pulsatingBorderColor,
          'custom.theme.footerButtons': footerButtons,
          'custom.theme.watermarkConfig.isActive': watermarkConfigIsActive,
          'custom.theme.watermarkConfig.text': watermarkConfigText,
          'custom.theme.watermarkConfig.url': watermarkConfigUrl,
        }
      }, { new: true })
    })
    .then((newStoryDoc) => {

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
      res.send(JSON.stringify(newStoryDoc.custom.theme))
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
