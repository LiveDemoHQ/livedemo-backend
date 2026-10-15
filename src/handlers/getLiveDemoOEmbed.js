// let test = {
//   'type': 'rich',
//   'version': '1.0',
//   'title': 'LiveDemo | Insider Threat protection from inside',
//   'provider_name': 'LiveDemo',
//   'provider_url': 'https://livedemo.com',
//   'thumbnail_url': 'https://image.mux.com/dsfw3243/thumbnail.png',
//   'html': '<iframe src="http://localhost.mine:3005/workspaces/62255d3d3304f17b8f5e2d03/stories/633734c1ec41453c90a3d45c/preview?step=1" allowfullscreen width="1024" height="1051" title="LiveDemo | Insider Threat protection from inside"></iframe>',
//   'width': 1024,
//   'height': 474
// }
//https://story-api.livedemo.ai/oembed/?url=https://www.gumlet.com/watch/6221db301c8b821b0519fba0

import * as sanitezeLib from '@braintree/sanitize-url'

const sanitize = sanitezeLib.sanitizeUrl

import ResponseCodes from '../constants/ResponseCodes.js'
import ENV from '../envServer.js'
import { parseOEmbedUrl } from '../helpers/agent/parseOEmbedUrl.js'
import { CORS_HEADERS, httpError } from '../helpers/agent/http.js'
import thumbnailForScreen from '../helpers/agent/thumbnailForScreen.js'

const DEFAULT_AGENT_WIDTH = 1024
const DEFAULT_AGENT_HEIGHT = 640

// Names go into `html` that consumers paste into their own pages
function escapeAttr(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function sendOEmbed(res, payload) {
  res.set(CORS_HEADERS)
  res.status(ResponseCodes['200_OK'])
  res.send(JSON.stringify(payload))
}

const handler = function (req, res) {
  let { Models } = req.mongo

  let targetUrl = req.query.url ? req.query.url : null
  let referrer = req.query.referrer ? sanitize(req.query.referrer) : ''
  let maxWidth = req.query.maxwidth || req.query.max_width || 0
  let maxHeight = req.query.maxheight || req.query.max_height || 0

  return Promise.resolve()
    .then(() => {
      let responseMessage = null

      try {
        maxWidth = parseInt(maxWidth)
      } catch (e) {
        responseMessage = 'Couldn\'t parse max_width'
        maxWidth = 0
      }

      try {
        maxHeight = parseInt(maxHeight)
      } catch (e) {
        responseMessage = 'Couldn\'t parse max_height'
        maxHeight = 0
      }

      if (maxWidth < 280 && maxWidth !== 0) {
        responseMessage = 'Incorrect max_width'
      }

      if (maxHeight < 200 && maxHeight !== 0) {
        responseMessage = 'Incorrect max_height'
      }

      if (responseMessage) {
        httpError(ResponseCodes['501_NOT_IMPLEMENTED'], responseMessage)
      }

      const parsed = parseOEmbedUrl(targetUrl)
      if (!parsed) {
        httpError(ResponseCodes['400_BAD_REQUEST'], 'Invalid url param')
      }
      return parsed
    })
    .then(async (parsed) => {
      if (parsed.kind === 'agent') {
        // Drafts: 404, so an agent id alone doesn't reveal name/thumbnail
        const agentQuery = { _id: parsed.id, deletedAt: null, isPublished: true }
        if (parsed.workspaceId) agentQuery.workspaceId = parsed.workspaceId
        const agent = await Models.AiDemoAgent.findOne(agentQuery).lean()
        if (!agent) {
          httpError(ResponseCodes['404_NOT_FOUND'], 'Agent not found')
        }

        let thumbnailImage = agent.avatarUrl || ''
        let oEmbedWidth = DEFAULT_AGENT_WIDTH
        let oEmbedHeight = DEFAULT_AGENT_HEIGHT

        if (agent.defaultDemoId) {
          const story = await Models.Story.findOne({
            _id: agent.defaultDemoId,
            deletedAt: null,
          })
            .populate({
              path: 'screens',
              select: '_id type imageUrl index asset',
              options: { sort: { index: 1 } },
            })
            .lean()
          const firstScreen = story && story.screens && story.screens[0]
          if (!thumbnailImage) thumbnailImage = thumbnailForScreen(firstScreen)
          if (story && story.tabInfo && story.tabInfo.width) oEmbedWidth = story.tabInfo.width
          if (story && story.tabInfo && story.tabInfo.height) oEmbedHeight = story.tabInfo.height
        }

        if (maxWidth && maxWidth <= oEmbedWidth) oEmbedWidth = maxWidth
        if (maxHeight && maxHeight <= oEmbedHeight) oEmbedHeight = maxHeight

        // /player is the HTML shell; /preview is the JSON payload it fetches
        const previewSrc = `${ENV.STORIES_API}/agents/${agent._id}/player`
        sendOEmbed(res, {
          type: 'rich',
          version: '1.0',
          title: agent.name,
          provider_name: 'LiveDemo',
          provider_url: 'https://livedemo.ai',
          thumbnail_url: thumbnailImage,
          html: `<iframe src="${previewSrc}" allowfullscreen width="${oEmbedWidth}" height="${oEmbedHeight}" title="${escapeAttr(agent.name)}"></iframe>`,
          width: oEmbedWidth,
          height: oEmbedHeight,
          referrer,
          cache_age: 60,
        })
        return
      }

      const storyQuery = { _id: parsed.id, deletedAt: null }
      if (parsed.workspaceId) storyQuery.workspaceId = parsed.workspaceId

      const foundStory = await Models.Story.findOne(storyQuery)
        .populate({
          path: 'screens',
          populate: [
            {
              path: 'customTransitions.gotoScreen',
              model: 'Screen',
              select: '_id name',
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
          select: '_id name type steps customTransitions imageUrl index imageUrl asset',
          options: { sort: { index: 1 } },
        })
        .populate('workspaceId', '_id name')

      if (!foundStory) {
        httpError(ResponseCodes['404_NOT_FOUND'], 'Story not found')
      }

      const firstScreen = foundStory.screens && foundStory.screens.length && foundStory.screens[0]
      const thumbnailImage = thumbnailForScreen(firstScreen)

      let oEmbedWidth = maxWidth && maxWidth <= foundStory.tabInfo.width ? maxWidth : foundStory.tabInfo.width
      let oEmbedHeight = maxHeight && maxHeight <= foundStory.tabInfo.height ? maxHeight : foundStory.tabInfo.height

      const workspaceId = foundStory.workspaceId._id || foundStory.workspaceId
      sendOEmbed(res, {
        type: 'rich',
        version: '1.0',
        title: foundStory.name,
        provider_name: 'LiveDemo',
        provider_url: 'https://livedemo.ai',
        thumbnail_url: thumbnailImage,
        html: `<iframe src="${ENV.STORIES_API}/workspaces/${workspaceId}/stories/${foundStory._id}/preview?step=1" allowfullscreen width="${oEmbedWidth}" height="${oEmbedHeight}" title="${escapeAttr(foundStory.name)}"></iframe>`,
        width: oEmbedWidth,
        height: oEmbedHeight,
        referrer,
        cache_age: 60,
      })
    })
    .catch((error) => {
      console.log(error)

      let resultResponse
      if (error.resultResponse) {
        resultResponse = error.resultResponse
      } else {
        resultResponse = {
          statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
          headers: CORS_HEADERS,
          body: '',
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body)
    })
}

export default handler
