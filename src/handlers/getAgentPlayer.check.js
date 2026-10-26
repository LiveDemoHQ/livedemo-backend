// Self-check for getAgentPlayer.js — run: node src/handlers/getAgentPlayer.check.js
// Fails (non-zero exit) if the HTML shell loses its mount node, bundle tag,
// window.config, payload hygiene, or the </script> escaping.
import assert from 'assert'
import handler from './getAgentPlayer.js'

import logger from '../helpers/logger.js'

const agentDoc = {
  _id: 'agent1',
  name: 'Evil</script><script>alert(1)</script>',
  workspaceId: 'ws1',
  welcomeMessage: 'hi',
  starterQuestions: [],
  avatarUrl: '',
  voiceEnabled: true,
  visitorCapture: { enabled: false },
  cta: {},
  isPublished: true, // publish gate open — no auth stubbing needed
  defaultDemoId: null, // skips validateDemoAction — no Story stub needed
  systemPrompt: 'SECRET_PROMPT',
}

const req = {
  mongo: { Models: { AiDemoAgent: { findOne: async () => agentDoc } } },
  params: { agentId: 'agent1' },
  query: {},
  headers: {},
}

let sentBody = null
let sentStatus = null
const res = {
  set() {},
  status(code) { sentStatus = code; return this },
  send(body) { sentBody = body },
}

await handler(req, res)

assert.strictEqual(sentStatus, 200, 'expected 200')
assert.ok(sentBody.includes('id="reactAgentApp"'), 'mount node missing')
assert.ok(sentBody.includes('agentInjectScript.bundle.js'), 'bundle script tag missing')
assert.ok(sentBody.includes('window.config ='), 'window.config missing')
assert.ok(!sentBody.includes('SECRET_PROMPT'), 'systemPrompt leaked into config')
assert.ok(!sentBody.includes('</script><script>alert'), 'agent name broke out of the config script tag')

const cfg = JSON.parse(sentBody.match(/window\.config = (.*?)<\/script>/)[1])
assert.strictEqual(cfg.agent._id, 'agent1')
assert.strictEqual(cfg.mode, 'published')
assert.strictEqual(cfg.sessionId, null)
assert.strictEqual(cfg.agent.theme, 'light', 'theme should default to light')
assert.strictEqual(cfg.embed, null, 'non-embed player must not carry embed config')

// ?embed=1 — framing policy for livedemo-embed.js
async function renderEmbed(embed, host) {
  const out = { headers: {} }
  await handler({
    ...req,
    mongo: { Models: { AiDemoAgent: { findOne: async () => ({ ...agentDoc, embed }) } } },
    query: { embed: '1', host },
  }, {
    set(headers) { Object.assign(out.headers, headers) },
    status(code) { out.status = code; return this },
    send(body) { out.body = body },
  })
  out.cfg = out.status === 200 ? JSON.parse(out.body.match(/window\.config = (.*?)<\/script>/)[1]) : null
  return out
}

const disabled = await renderEmbed({ enabled: false, allowedDomains: [] }, 'https://acme.com')
assert.strictEqual(disabled.status, 403, 'embed disabled must 403')

const locked = await renderEmbed({ enabled: true, allowedDomains: ['acme.com', '*.acme.io'], showBranding: true }, 'https://acme.com')
assert.ok(locked.headers['Content-Security-Policy'].includes('frame-ancestors'), 'frame-ancestors missing')
assert.ok(locked.headers['Content-Security-Policy'].includes('https://acme.com https://*.acme.io;'), 'allowedDomains not in frame-ancestors')
assert.strictEqual(locked.cfg.embed.host, 'https://acme.com')
assert.strictEqual(locked.cfg.embed.showBranding, true)

const spoofed = await renderEmbed({ enabled: true, allowedDomains: ['acme.com'] }, 'https://evil.com')
assert.strictEqual(spoofed.cfg.embed.host, null, 'host outside allowedDomains must be dropped')

const open = await renderEmbed({ enabled: true, allowedDomains: [] }, 'https://anyone.dev')
assert.ok(open.headers['Content-Security-Policy'].includes('frame-ancestors *;'), 'empty allowedDomains = frame-ancestors *')
assert.strictEqual(open.cfg.embed.host, 'https://anyone.dev')

logger.info('getAgentPlayer.check OK', { eventName: 'GETAGENTPLAYER_CHECK_OK' })
