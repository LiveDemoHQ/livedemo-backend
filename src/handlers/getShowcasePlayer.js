import ResponseCodes from '../constants/ResponseCodes.js'
import ENV from '../envServer.js'
import { sendError } from '../helpers/agent/http.js'
import { allowedOrigin, frameAncestors, resolveShowBranding } from '../helpers/agent/embed.js'
import { VIDEO_FRAME_SRC } from '../helpers/showcase/normalizeShowcase.js'
import { loadPublicShowcase, resolveItems, publicShowcase } from '../helpers/showcase/showcase.js'

const strip = value => String(value || '').replace(/[<>&"]/g, '')

// GET /showcases/:showcaseId/player[?embed=1&host=&item=] — HTML shell for showcaseInjectScript.bundle.js.
// Clone of getAgentPlayer: window.config, a mount node, one script tag. Session-free (the bundle mints one).
const handler = async function (req, res) {
    const { Models } = req.mongo

    try {
        const showcase = await loadPublicShowcase(req, Models, req.params.showcaseId)
        const items = await resolveItems(Models, showcase, 'published')
        const showBranding = await resolveShowBranding(Models, showcase)

        // ?embed=1 = iframed on a customer site. frame-ancestors is the real gate.
        let embed = null
        let frameAncestorsDirective = ''
        if (req.query.embed === '1') {
            if (!showcase.isPublished || !showcase.embed || !showcase.embed.enabled) {
                res.set({ 'Content-Type': 'text/html; charset=utf-8' })
                res.status(ResponseCodes['403_FORBIDDEN'])
                res.send('<html><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100%;font-family:sans-serif;color:#888;background:#f6f7fb">' +
                    'Embedding is turned off for this showcase.</body></html>')
                return
            }
            const domains = showcase.embed.allowedDomains || []
            frameAncestorsDirective = ` frame-ancestors ${frameAncestors(domains, ENV.SERVER_URL)};`
            embed = { host: allowedOrigin(req.query.host, domains) }
        }

        const initialItemId = items.some(item => item._id === req.query.item) ? req.query.item : null

        const config = {
            showcase: publicShowcase(showcase),
            items,
            mode: 'published',
            embed,
            showBranding,
            initialItemId,
            STORIES_API: ENV.STORIES_API
        }

        const bundleSrc = ENV.ENV === 'dev'
            ? 'http://localhost.mine:8083/showcaseInjectScript.bundle.js'
            : 'https://livedemo-cdn.s3.us-east-1.amazonaws.com/static/showcaseInjectScript.bundle.js'

        const seo = showcase.seo || {}
        const header = showcase.header || {}
        const theme = showcase.theme || {}
        const title = strip(seo.title || header.title || showcase.name || 'LiveDemo Showcase')
        const description = strip(seo.description || header.subtitle)
        const ogImage = strip((items.find(item => item.thumbnailUrl) || {}).thumbnailUrl)
        const background = theme.backgroundColor || (theme.mode === 'dark' ? '#0b0d12' : '#f6f7fb')

        const htmlString = '<html lang="en"><head>' +
            '<link rel="shortcut icon" type="image/png" href="https://livedemo-cdn.s3.amazonaws.com/static/logo-round.png"/>\n' +
            '<meta charSet="UTF-8"/>\n' +
            '<meta name="viewport" content="width=device-width, initial-scale=1"/>\n' +
            '<meta name="generator" content="Powered by LiveDemo -- Demo the future. Visit us at https://livedemo.ai."/>\n' +
            `<title>${title}</title>\n` +
            (description ? `<meta name="description" content="${description}"/>\n` : '') +
            `<meta property="og:title" content="${title}"/>\n` +
            (description ? `<meta property="og:description" content="${description}"/>\n` : '') +
            (ogImage ? `<meta property="og:image" content="${ogImage}"/>\n` : '') +
            `<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}"/>\n` +
            (seo.noindex !== false ? '<meta name="robots" content="noindex"/>\n' : '') +
            '<link rel="preconnect" href="https://fonts.googleapis.com"/>\n' +
            '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>\n' +
            '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700&display=swap"/>\n' +
            // \u003c-escape so a name containing </script> cannot break out
            `<script>window.config = ${JSON.stringify(config).replace(/</g, '\\u003c')}</script>\n` +
            `<script src="${bundleSrc}" type="text/javascript" async></script>\n` +
            '<style>' +
            `html,body{margin:0;width:100%;height:100%;background:${background};font-family:Lexend,sans-serif;}` +
            'button,input{font-family:inherit;}' +
            '#reactShowcaseApp{width:100%;height:100%;}' +
            '@keyframes ld-spinner-rotate{100%{transform:rotate(360deg)}}' +
            '@keyframes ld-spinner-dash{0%{stroke-dasharray:1,150;stroke-dashoffset:0}50%{stroke-dasharray:90,150;stroke-dashoffset:-35}100%{stroke-dasharray:90,150;stroke-dashoffset:-124}}' +
            '#ld-spinner{position:fixed;top:50%;left:50%;margin:-25px 0 0 -25px;width:50px;height:50px;animation:ld-spinner-rotate 2s linear infinite;}' +
            `#ld-spinner .path{stroke:${strip(theme.accentColor) || '#1070ff'};stroke-linecap:round;fill:none;stroke-width:5;animation:ld-spinner-dash 1.5s ease-in-out infinite;}` +
            '</style>' +
            '</head><body>' +
            '<div id="reactShowcaseApp">' +
            '<svg id="ld-spinner" viewBox="0 0 50 50"><circle class="path" cx="25" cy="25" r="20"></circle></svg>' +
            '</div></body></html>'

        const devHosts = ENV.ENV === 'dev' ? ' http://localhost.mine:8083 ws://localhost.mine:8083' : ''

        // Story previews and agent players are our own origin (STORIES_API); videos are the provider allow-list
        const CSP =
            `default-src 'self' 'unsafe-inline' ${ENV.STORIES_API} ${ENV.LIVEDEMO_CDN_URL} https://fonts.googleapis.com; ` +
            `connect-src 'self' ${ENV.STORIES_API}${devHosts}; ` +
            `script-src 'self' 'unsafe-eval' 'unsafe-inline' ${ENV.INJECT_BUNDLE_HOST} ${ENV.STORIES_API}${devHosts}; ` +
            `img-src 'self' data: *; ` +
            `font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com; ` +
            `frame-src 'self' ${ENV.STORIES_API} ${VIDEO_FRAME_SRC};` +
            frameAncestorsDirective

        res.set({
            'Content-Type': 'text/html; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Content-Security-Policy': CSP,
            'Permissions-Policy': 'autoplay=*, microphone=(self), fullscreen=*'
        })
        res.status(ResponseCodes['200_OK'])
        res.send(htmlString)
    } catch (error) {
        sendError(res, error)
    }
}

export default handler
