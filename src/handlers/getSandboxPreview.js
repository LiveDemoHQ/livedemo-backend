import ENV from '../envServer.js'
import he from 'he'
import ResponseCodes from '../constants/ResponseCodes.js'
import { CORS_HEADERS } from '../helpers/agent/http.js'
import { isObjectId } from '../helpers/sandbox/sandbox.js'

// Player HTML for mode: 'sandbox' stories. getStoryPreview delegates here, so the
// public URL, embed snippets and Showcase items stay the same as for StoryDemos.
// ?screen=<id> deep link, ?flow=<flowId> start in a flow, ?restrict=1 keep the viewer in it.

const SCREEN_FIELDS = '_id name type width height imageUrl index recordingRole baseScreenId fromTimeMs toTimeMs eventCount sandboxLinks sandboxHidden sandboxDuplicateOf'

function json(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c')
}

function page(res, statusCode, html, csp) {
    res.set({
        ...CORS_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'Origin-Agent-Cluster': '?0',
        ...(csp ? { 'Content-Security-Policy': csp } : {})
    })
    res.status(statusCode)
    res.send(html)
}

export default async function getSandboxPreview(req, res, storyId) {
    const { Models } = req.mongo
    const story = await Models.Story.findOne({ _id: storyId, deletedAt: null })
        .populate({ path: 'screens', select: SCREEN_FIELDS, options: { sort: { index: 1 } } })
        .lean()
    const isEmbed = req.query.embed || req.query.embed === ''
    const sandbox = story.sandbox || {}

    if (isEmbed && sandbox.allowEmbed === false) {

        return page(res, ResponseCodes['403_FORBIDDEN'], '<!doctype html><meta charset="utf-8"><p style="font-family:sans-serif">Embedding is turned off for this sandbox.</p>')
    }

    const flowId = isObjectId(req.query.flow) ? String(req.query.flow) : null
    const config = {
        mode: 'sandbox',
        SCREENS: story.screens,
        STEPS: [],
        workspaceId: String(story.workspaceId),
        storyId: String(story._id),
        storyDemo: story,
        isEmbed: !!isEmbed,
        initialScreenId: isObjectId(req.query.screen) ? String(req.query.screen) : null,
        flowId,
        restrictToFlow: !!flowId && req.query.restrict === '1'
    }

    const name = he.encode(story.name || 'Sandbox')
    const first = story.screens.find(s => !s.sandboxHidden) || {}
    const image = he.encode(story.thumbnailImageUrl || first.imageUrl || '')
    const font = story.custom && story.custom.theme && /^[A-Za-z0-9 ]{1,50}$/.test(story.custom.theme.fontFamily || '') ? story.custom.theme.fontFamily : ''
    const bundle = ENV.ENV === 'dev'
        ? 'http://localhost.mine:8080/injectScript.bundle.js'
        : 'https://livedemo-cdn.s3.us-east-1.amazonaws.com/static/injectScript.bundle.js'

    const html = '<!doctype html><html><head>' +
        '<meta charset="utf-8"/>' +
        '<meta name="viewport" content="width=device-width, initial-scale=1"/>' +
        '<link rel="shortcut icon" type="image/png" href="https://livedemo-cdn.s3.amazonaws.com/static/logo-round.png"/>' +
        `<title>${name}</title>` +
        `<meta property="og:title" content="${name}"/>` +
        `<meta property="og:image" content="${image}"/>` +
        '<meta property="og:site_name" content="LiveDemo"/>' +
        '<meta name="twitter:card" content="summary_large_image"/>' +
        (font
            ? `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(font).replace(/%20/g, '+')}:wght@400;500;600;700&display=swap"/><style>:root{--ld-demo-font:'${font}', sans-serif;}</style>`
            : '') +
        `<script>window.config = ${json(config)}</script>` +
        `<script src="${bundle}" async></script>` +
        '<style>html,body,#reactInjectTourApp{margin:0;width:100%;height:100%;}' +
        '@keyframes ld-spinner-rotate{100%{transform:rotate(360deg)}}' +
        '@keyframes ld-spinner-dash{0%{stroke-dasharray:1,150;stroke-dashoffset:0}50%{stroke-dasharray:90,150;stroke-dashoffset:-35}100%{stroke-dasharray:90,150;stroke-dashoffset:-124}}' +
        '#ld-spinner{position:fixed;top:50%;left:50%;margin:-25px 0 0 -25px;width:50px;height:50px;animation:ld-spinner-rotate 2s linear infinite;}' +
        '#ld-spinner .path{stroke:#1070ff;stroke-linecap:round;fill:none;stroke-width:5;animation:ld-spinner-dash 1.5s ease-in-out infinite;}</style>' +
        '</head><body><div id="reactInjectTourApp"><svg id="ld-spinner" viewBox="0 0 50 50"><circle class="path" cx="25" cy="25" r="20"></circle></svg></div></body></html>'

    const csp = [
        `default-src 'self' 'unsafe-eval' 'unsafe-inline' blob: ${ENV.STORIES_API} ${ENV.LIVEDEMO_CDN_URL} https://cdn.jsdelivr.net`,
        `connect-src 'self' ${ENV.INJECT_BUNDLE_HOST} ${ENV.STORIES_API}${ENV.ENV === 'dev' ? ' ws://localhost.mine:8080 ws://localhost.mine:3005' : ''}`,
        `script-src 'self' 'unsafe-eval' 'unsafe-inline' http://localhost.mine:8080 ${ENV.INJECT_BUNDLE_HOST} ${ENV.STORIES_API} blob:`,
        "img-src 'self' data: blob: *",
        "style-src 'self' 'unsafe-inline' blob: https:",
        "font-src 'self' https: data:",
        `frame-src 'self' blob: ${ENV.STORIES_API}`,
        "media-src 'self' blob: https:"
    ].join('; ')

    return page(res, ResponseCodes['200_OK'], html, csp)
}
