import ResponseCodes from '../constants/ResponseCodes.js'
import ENV from '../envServer.js'
import loadPublicAgent from '../helpers/agent/loadPublicAgent.js'
import { validateDemoAction } from '../helpers/agent/validateActions.js'
import { sendError } from '../helpers/agent/http.js'
import { usesAnamVoice } from '../helpers/agent/anam.js'
import { allowedOrigin, frameAncestors, resolveShowBranding } from '../helpers/agent/embed.js'

// Third-party hosts the agent bundle talks to directly (WebRTC media is not CSP-governed):
// - Anam SDK: REST + signaling; the signaling host comes from the session, so wildcard.
//   https://anam.ai/docs/security/network
// - ElevenLabs Scribe realtime (push-to-talk), URL from helpers/elevenlabsScribeRealtime.js
// - LiveKit (LemonSlice faces): signaling on LIVEKIT_URL; LiveKit Cloud may hop to a regional host.
const LIVEKIT_URL = String(ENV.LIVEKIT_URL || '').replace(/\/+$/, '')
const THIRD_PARTY_CONNECT_SRC = [
  'https://api.anam.ai', 'https://*.anam.ai', 'wss://*.anam.ai',
  'wss://api.elevenlabs.io', 'https://api.elevenlabs.io',
  'wss://*.livekit.cloud', 'https://*.livekit.cloud',
  ...(LIVEKIT_URL ? [LIVEKIT_URL, LIVEKIT_URL.replace(/^ws/, 'http')] : []),
].join(' ')

// GET /agents/:agentId/player — standalone HTML shell for the agent chrome
// (chat + demo iframe). Clone of the getStoryPreview delivery pattern: emit
// window.config, a mount node, and one script tag for agentInjectScript.bundle.js.
// Same payload hygiene as getAgentPreview: no systemPrompt, no knowledge text.
// The bundle mints a session itself (POST /agents/:id/session) unless
// ?sessionId= is passed, so this HTML stays session-free and cacheable.
const handler = async function (req, res) {
  const { Models } = req.mongo
  const agentId = req.params.agentId

  try {
    const agent = await loadPublicAgent(req, Models, agentId)
    const mode = req.agentMode === 'editor' ? 'editor' : 'published'

    let defaultDemoId = null
    if (agent.defaultDemoId) {
      const validated = await validateDemoAction(Models, agent, mode, agent.defaultDemoId, 1)
      defaultDemoId = validated ? String(validated.demoId) : null
    }

    // ?embed=1 = framed by livedemo-embed.js on a customer site. frame-ancestors is the real gate.
    // Visitor context (email, question, pageUrl…) rides in the URL fragment and never reaches us.
    let embed = null
    let frameAncestorsDirective = ''
    if (req.query.embed === '1') {
      if (!agent.isPublished || !agent.embed || !agent.embed.enabled) {
        res.set({ 'Content-Type': 'text/html; charset=utf-8' })
        res.status(ResponseCodes['403_FORBIDDEN'])
        res.send('<html><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100%;font-family:sans-serif;color:#888;background:#111318">' +
          'Embedding is turned off for this agent.</body></html>')
        return
      }
      const domains = agent.embed.allowedDomains || []
      frameAncestorsDirective = ` frame-ancestors ${frameAncestors(domains, ENV.SERVER_URL)};`
      embed = {
        host: allowedOrigin(req.query.host, domains),
        showBranding: await resolveShowBranding(Models, agent),
      }
      // data-livedemo-demo: opens instead of the default demo, only if this agent may show it
      if (/^[a-f0-9]{24}$/i.test(String(req.query.demo || ''))) {
        const requested = await validateDemoAction(Models, agent, 'published', req.query.demo, 1)
        if (requested) defaultDemoId = String(requested.demoId)
      }
    }

    const config = {
      agent: {
        _id: agent._id,
        name: agent.name,
        workspaceId: String(agent.workspaceId),
        welcomeMessage: agent.welcomeMessage,
        starterQuestions: agent.starterQuestions,
        avatarUrl: agent.avatarUrl,
        theme: agent.theme || 'light',
        voiceEnabled: agent.voiceEnabled,
        avatarsEnabled: !!agent.avatarsEnabled,
        anamAvatarId: agent.anamAvatarId || '',
        avatarProvider: agent.avatarProvider || 'anam',
        lemonsliceAvatarId: agent.lemonsliceAvatarId || '',
        avatarVoice: usesAnamVoice(agent) ? 'anam' : 'elevenlabs',
        visitorCapture: agent.visitorCapture,
        cta: agent.cta,
        recapEnabled: agent.recapEnabled !== false,
        isPublished: agent.isPublished,
        defaultDemoId,
        // Page rules: the player applies the matching rule's starter questions (embed only)
        ...(embed ? { embedRules: (agent.embed && agent.embed.rules) || [] } : {}),
      },
      mode,
      sessionId: req.query.sessionId || null,
      STORIES_API: ENV.STORIES_API,
      embed,
    }

    const bundleSrc = ENV.ENV === 'dev'
      ? 'http://localhost.mine:8081/agentInjectScript.bundle.js'
      : 'https://livedemo-cdn.s3.us-east-1.amazonaws.com/static/agentInjectScript.bundle.js'

    const title = String(agent.name || 'LiveDemo Agent').replace(/[<>&"]/g, '')

    const htmlString = '<html><head>' +
      '<link rel="shortcut icon" type="image/png" href="https://livedemo-cdn.s3.amazonaws.com/static/logo-round.png"/>\n' +
      '<meta charSet="UTF-8"/>\n' +
      '<meta content="text/html; charset=UTF-8" http-equiv="Content-Type"/>\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1"/>\n' +
      '<meta name="generator" content="Powered by LiveDemo -- Demo the future. Visit us at https://livedemo.ai."/>\n' +
      `<title>${title}</title>\n` +
      // Lexend in the HTML shell: the bundle is async and chat UI inherits
      // from body. Without this, an iframed player falls back to Times.
      '<link rel="preconnect" href="https://fonts.googleapis.com"/>\n' +
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>\n' +
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700&display=swap"/>\n' +
      // \u003c-escape so an agent name containing </script> cannot break out
      `<script>window.config = ${JSON.stringify(config).replace(/</g, '\\u003c')}</script>\n` +
      `<script src="${bundleSrc}" type="text/javascript" async></script>\n` +
      '<style>' +
      'html,body{margin:0;width:100%;height:100%;background:#111318;font-family:Lexend,sans-serif;}' +
      'button,input,textarea{font-family:inherit;}' +
      '#reactAgentApp{width:100%;height:100%;}' +
      '@keyframes ld-spinner-rotate{100%{transform:rotate(360deg)}}' +
      '@keyframes ld-spinner-dash{0%{stroke-dasharray:1,150;stroke-dashoffset:0}50%{stroke-dasharray:90,150;stroke-dashoffset:-35}100%{stroke-dasharray:90,150;stroke-dashoffset:-124}}' +
      '#ld-spinner{position:fixed;top:50%;left:50%;margin:-25px 0 0 -25px;width:50px;height:50px;animation:ld-spinner-rotate 2s linear infinite;z-index:9999;will-change:transform;}' +
      '#ld-spinner .path{stroke:#1070ff;stroke-linecap:round;fill:none;stroke-width:5;animation:ld-spinner-dash 1.5s ease-in-out infinite;will-change:transform;}' +
      '</style>' +
      '</head><body>' +
      '<div id="reactAgentApp">' +
      '<svg id="ld-spinner" viewBox="0 0 50 50"><circle class="path" cx="25" cy="25" r="20"></circle></svg>' +
      '</div></body></html>'

    // getStoryPreview's CSP minus the hubspot/mux/rrweb sources that only the
    // inner story iframe (its own document, own CSP) needs. 8081 is the agent
    // bundle's webpack-dev-server in dev.
    const devHosts = ENV.ENV === 'dev'
      ? ' http://localhost.mine:8081 ws://localhost.mine:8081 ws://localhost.mine:3005'
      : ''

    const CSP =
      `default-src 'self' 'unsafe-eval' 'unsafe-inline' blob: ${ENV.STORIES_API} ${ENV.LIVEDEMO_CDN_URL} https://fonts.googleapis.com; ` +
      `connect-src 'self' ${ENV.INJECT_BUNDLE_HOST} ${ENV.STORIES_API} ${THIRD_PARTY_CONNECT_SRC}${devHosts}; ` +
      `script-src 'self' 'unsafe-eval' 'unsafe-inline' blob: ${ENV.INJECT_BUNDLE_HOST} ${ENV.STORIES_API}${ENV.ENV === 'dev' ? ' http://localhost.mine:8081' : ''}; ` +
      `img-src 'self' data: *; ` +
      `font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com ${ENV.LIVEDEMO_CDN_URL} ${ENV.INJECT_BUNDLE_HOST}${ENV.ENV === 'dev' ? ' http://localhost.mine:8081 http://localhost:*' : ''}; ` +
      `frame-src 'self' blob: ${ENV.STORIES_API} https://calendly.com https://*.calendly.com https://cal.com https://*.cal.com; ` +
      `media-src 'self' blob: ${ENV.STORIES_API} https://livedemo-cdn.s3.amazonaws.com https://livedemo-cdn.s3.us-east-1.amazonaws.com;` +
      frameAncestorsDirective

    res.set({
      'Origin-Agent-Cluster': '?0',
      'Access-Control-Max-Age': 600,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
      'Access-Control-Allow-Credentials': true,
      'Content-Security-Policy': CSP,
      'Permissions-Policy': 'autoplay=*, microphone=(self)',
    })
    res.status(ResponseCodes['200_OK'])
    res.send(htmlString)
  } catch (error) {
    sendError(res, error)
  }
}

export default handler
