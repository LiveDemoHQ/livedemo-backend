import helpers from '../helpers/livedemoHelpers.js'
import fsp from 'fs/promises'
import ResponseCodes from '../constants/ResponseCodes.js'
import ScreenTypes from '../constants/ScreenTypes.js'
import ENV from '../envServer.js'
import { getChecklistContext, configJson } from '../helpers/checklist/checklist.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let requestBody = null

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let authUserDoc = null

  let stepIndex = 0

  return Promise.resolve().then(async () => {

      // return authReq(req)
    })
    // .then(({ authUser }) => {
    // authUserDoc = authUser

    // let validatedBody = validateBody(req.body, patchScreenValidator)
    // requestBody = validatedBody.value

    // validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    // })
    .then(async () => {
      stepIndex = req.query.step && parseInt(req.query.step) - 1


      return Models.Story.findOne({
          _id: storyId,
          deletedAt: null
        })
        .populate({
          path: 'screens',
          populate: [
            {
              path: 'customTransitions.gotoScreen',
              model: 'Screen',
              select: '_id name'
            },
            {
              path: 'steps.view.formId',
              model: 'Form',
            },
            {
              path: 'steps.stepAudioId',
              model: 'Audio',
            },
          ],
          select: '_id name type steps customTransitions width height imageUrl index imageUrl asset playbackRate',
          options: { sort: { 'index': 1 } }
        })
        .lean()
    })
    .then(async (storyDoc) => {
      let firstScreen = storyDoc.screens && storyDoc.screens.length && storyDoc.screens[0]

      let thumbnailImage = firstScreen.type === ScreenTypes.SCREEN_VIDEO ? `https://image.mux.com/${firstScreen.asset.playback_ids[0].id}/thumbnail.png` : firstScreen.imageUrl

      let htmlString = '<html><head>'

      htmlString += '<link rel="shortcut icon" type="image/png" href="https://livedemo-cdn.s3.amazonaws.com/static/logo-round.png"/>\n' +
        '    <link rel="apple-touch-icon" href="https://livedemo-cdn.s3.amazonaws.com/static/logo-round.png"/>\n' +
        '    <meta name="msapplication-TileImage" content="https://livedemo-cdn.s3.amazonaws.com/static/logo-round.png"/>\n' +
        '    <link rel="alternate" type="application/json+oembed"\n' +
        `          href="${ENV.STORIES_API}/oembed?url=${ENV.STORIES_API}/workspaces/${storyDoc.workspaceId}/stories/${storyDoc._id}/preview"\n` +
        `          title="${storyDoc.name}"/>\n` +
        '    <meta charSet="UTF-8"/>\n' +
        '    <meta name="generator"\n' +
        '          content="Powered by LiveDemo -- Demo the future. Visit us at https://livedemo.ai."/>\n' +
        '    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type"/>\n' +
        '    <meta name="viewport" content="width=device-width, initial-scale=1"/>\n' +
        '    <meta name="robots" content="max-image-preview:large"/>\n' +
        '    <meta name="author" content="livedemo.ai"/>\n' +
        '    <meta name="copyright" content="LiveDemo"/>\n' +
        '    <meta name="twitter:card" content="player"/>\n' +
        '    <meta name="twitter:site" content="@Live_Demo_Live"/>\n' +
        `    <meta name="twitter:title" content="${storyDoc.name}"/>\n` +
        '    <meta name="twitter:description" content=""/>\n' +
        '    <meta name="twitter:image:alt" content=""/>\n' +
        '    <meta name="twitter:image"\n' +
        `          content="${thumbnailImage}"/>\n` +
        `    <meta name="twitter:player" content="${ENV.STORIES_API}/workspaces/${storyDoc.workspaceId}/stories/${storyDoc._id}/preview?step=1"/>\n` +
        '    <meta name="twitter:player:width" content="480"/>\n' +
        '    <meta name="twitter:player:height" content="242"/>\n' +
        '    <meta property="og:locale" content="en_US"/>\n' +
        '    <meta property="og:site_name" content="LiveDemo"/>\n' +
        `    <meta name="title" property="og:title" content="${storyDoc.name}"/>\n` +
        '    <meta name="description" property="og:description" content=""/>\n' +
        '    <meta name="image" property="og:image"\n' +
        `          content="${thumbnailImage}"/>\n` +
        `    <meta property="og:url" content="${ENV.STORIES_API}/workspaces/${storyDoc.workspaceId}/stories/${storyDoc._id}/preview?step=1"/>\n` +
        '    <meta property="og:image:width" content="480"/>\n' +
        '    <meta property="og:image:height" content="242"/>\n' +
        '    <meta property="og:type" content="article"/>\n' +
        `    <meta property="article:modified_time" content="${storyDoc.updatedAt.toISOString()}"/>\n`

      // htmlString += '<link href="https://fonts.cdnfonts.com/css/gagalin" rel="stylesheet">'

      // htmlString += '<script src="https://cdn.lr-in-prod.com/LogRocket.min.js" crossorigin="anonymous"></script>\n' +
      //   '<script>window.LogRocket && window.LogRocket.init(\'dotxvj/livedemo\', {  mergeIframes: true });</script>\n'

      let screenIds = storyDoc.screens.map(screen => screen._id)
      let transitions = storyDoc.screens.reduce((accum, screen) => {

        if (!screen.customTransitions) {

          return accum
        }

        accum[screen._id] = screen.customTransitions
        return accum
      }, {})

      let steps = storyDoc.screens.sort((firstScreen, secondScreen) => firstScreen.index - secondScreen.index).reduce((accum, screen) => {

        let screenSteps = []

        if (screen.steps) {
          screenSteps = screen.steps.map(step => {
            step.screenId = screen._id
            step.type = screen.type
            step.screenWidth = screen.width
            step.screenHeight = screen.height


            return step
          })

        } else if (screen.type === 'Screen_Screenshot') {

          let stepObj = {
            screenId: screen._id,
            type: screen.type,
            imageUrl: screen.imageUrl,
            customTransitions: screen.customTransitions
          }

          screenSteps.push(stepObj)

        } else if (screen.type === 'Screen_Video') {
          screenSteps.push({
            screenId: screen._id,
            type: screen.type,
            asset: screen.asset,
            playbackRate: screen.playbackRate
          })
        } else {

          screenSteps.push({
            screenId: screen._id,
            type: screen.type
          })
        }



        accum = accum.concat(screenSteps)

        return accum
      }, [])

      steps = steps.map((step, index) => {
        step.index = index
        return step
      })

      // Checklist "Open step" task: ?stepId= wins over ?step=
      const stepIdIndex = req.query.stepId ? steps.findIndex(step => String(step._id) === String(req.query.stepId)) : -1
      if (stepIdIndex !== -1) {

        stepIndex = stepIdIndex
      }

      if (steps.length !== 0) {

        if (stepIndex > steps[steps.length - 1].index) {

          stepIndex = steps[steps.length - 1].index
        } else if (stepIndex < steps[0].index) {

          stepIndex = steps[0].index
        }
      }


      const checklistContext = await getChecklistContext(Models, storyDoc, {
        hostId: req.query.checklist,
        token: req.query.cl,
        hide: !!req.query.hideChecklist,
        variables: storyDoc.custom.variables || []
      })

      htmlString += '<script>\n' +
        'window.config = {\n' +
        'SCREENS: ' + '[\'' + screenIds.join('\',\'') + '\'],' + '\n' +

        'STEPS: ' + JSON.stringify(steps, null, 2) + '\n,' +
        'TRANSITIONS: ' + JSON.stringify(transitions, null, 2) + '\n,' +
        'workspaceId: "' + storyDoc.workspaceId + '"\n,' +
        'currentStepIndex: ' + stepIndex + '\n,' +
        'storyId: "' + storyDoc._id + '"\n,' +
        'checklistContext: ' + configJson(checklistContext) + '\n,' +
        'storyDemo: ' + JSON.stringify(storyDoc, null, 2) + '\n,' +
        'hasEnded: ' + 'false' + '\n' +

        '}\n' +

        '</script>\n'

      await new Promise(async (resolve, reject) => {

        if (ENV.ENV === 'dev') {

          htmlString += '\n<script src="http://localhost.mine:8080/injectScript.bundle.js" type="text/javascript"></script>\n'
          resolve()
        } else {

          htmlString += '\n<script src="https://livedemo-cdn.s3.us-east-1.amazonaws.com/static/injectScript.bundle.js" type="text/javascript"></script>\n'
          resolve()

          // await fsp.readFile('./src/injectScript/injectScript.bundle.js', { encoding: 'utf-8' })
          //   .then((injectScriptString) => {
          //
          //
          //     htmlString += `<script>\n ${injectScriptString} \n</script>`
          //     resolve()
          //   })
        }


      })


      htmlString += '    <meta name="viewport" content="width=device-width,initial-scale=1">\n' +
        '    <meta http-equiv="X-UA-Compatible" content="IE=edge">\n' +
        '    <meta charset="utf-8">\n' +
        '    <title>LiveDemo</title>\n' +
        '    <link rel="shortcut icon" href="https://app.livedemo.ai/favicon.ico">\n' +
        '    <link href="https://app.livedemo.ai/npm.antd.22ac6bf460102b138bd1.css" rel="stylesheet">\n' +
        '    <link href="https://app.livedemo.ai/main.5e127e43bab44cb0e073.css" rel="stylesheet">\n'

      htmlString += '</head><body>' +
        '<div id="app" style="height:100%;width:100%"></div>\n' +
        '\n</body></html>'

        // '<script type="text/javascript" src="https://app.livedemo.ai/runtime.41538a0d3756d852bef8.js"></script>\n' +
        // '<script type="text/javascript" src="https://app.livedemo.ai/npm.antd.bundle.js"></script>\n' +
        // '<script type="text/javascript" src="https://app.livedemo.ai/npm.emotion.bundle.js"></script>\n' +
        // '<script type="text/javascript" src="https://app.livedemo.ai/main.bundle.js"></script>\n</body></html>'

      return htmlString
    })
    .then((htmlString) => {

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
      res.send(htmlString)
    })
    .catch((error) => {
      logger.error(error, { eventName: 'GET_LIVE_DEMO_PREVIEW_FAILED' })

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
