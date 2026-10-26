import helpers from '../helpers/livedemoHelpers.js'
import loadPublicAgent from '../helpers/agent/loadPublicAgent.js'
import ENV from '../envServer.js'
import moment from 'moment'
import short from 'short-uuid'
import ResponseCodes from '../constants/ResponseCodes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import rateLimit from '../helpers/agent/rateLimit.js'
import { buildPersonalization, companyFromDomain, encodeVars } from '../helpers/agent/personalization.js'
import { writeField } from '../helpers/agent/qualification.js'
import { emitSafe, recapUrl, sessionPayload } from '../helpers/workspaceEvents.js'
import isAnalyticsExcludedIp from '../helpers/isAnalyticsExcludedIp.js'

import logger from '../helpers/logger.js'

const CHANNELS = ['link', 'oembed', 'embed']
const TRIGGERS = ['bubble', 'pill', 'pill_mic', 'preview', 'chip', 'button', 'api', 'smartbar', 'auto']
const EMBED_CAPTURED_VIA = ['embed_pill', 'embed_identify']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const clip = (value, max = 2048) => String(value || '').slice(0, max)

// Client-reported, so shape-check and truncate everything
function parseSource(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const utm = {}
  Object.entries(source.utm && typeof source.utm === 'object' ? source.utm : {})
    .filter(([key]) => /^utm_[a-z_]{1,30}$/.test(key))
    .slice(0, 10)
    .forEach(([key, value]) => { utm[key] = clip(value, 256) })
  return {
    channel: CHANNELS.includes(source.channel) ? source.channel : 'link',
    trigger: TRIGGERS.includes(source.trigger) ? source.trigger : undefined,
    pageUrl: clip(source.pageUrl),
    referrer: clip(source.referrer),
    utm,
  }
}

// ?acct=acme.com / ?acct=acme-corp links and identify({ company }) -> {{company}} etc.
function parsePersonalization(raw, visitorName, visitorEmail) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const acct = clip(input.acct, 100).trim().toLowerCase()
  const acctDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(acct) ? acct : ''
  return buildPersonalization(
    { name: visitorName, email: visitorEmail },
    acctDomain ? { domain: acctDomain } : (/^[a-z0-9-]{1,60}$/.test(acct) ? { company: companyFromDomain(acct) } : {}),
    { company: clip(input.company, 80), firstName: clip(input.firstName, 60) }
  )
}

// POST /agents/:agentId/session  { visitor: { name, email }, source?, capturedVia? }
// Public when published (loadPublicAgent gate), geo like postStorySession.
// Also writes a Lead when the connect modal (or embed pill / identify) captured name/email.
const handler = async function (req, res) {
  const { Models } = req.mongo
  const agentId = req.params.agentId
  const body = req.body || {}

  let clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'] : (ENV.ENV === 'dev' ? '69.200.224.152' : '')
  clientIp = clientIp.split(',')[0]

  try {
    const agent = await loadPublicAgent(req, Models, agentId)

    // 'editor' mode only via the authenticated twin route (req.agentMode)
    const mode = req.agentMode === 'editor' ? 'editor' : 'published'

    // Embeds put the agent in front of every landing-page visitor; sessions cost Gemini/voice money
    if (mode === 'published' && ENV.ENV !== 'dev') {
      await rateLimit(`session:${clientIp}:${agentId}`, 10, 60 * 60 * 1000)
    }

    const visitor = body.visitor || {}
    const visitorName = clip(visitor.name, 200).trim()
    const visitorEmail = clip(visitor.email, 254).trim()
    if (visitorEmail && !EMAIL_RE.test(visitorEmail)) {
      httpError(ResponseCodes['400_BAD_REQUEST'], 'visitor.email is not a valid email')
    }
    const source = parseSource(body.source)

    let clientIpData = {}
    if (clientIp) {
      try {
        const data = await helpers.getClientIpData(clientIp)
        clientIpData = {
          ip: data.ip,
          continent: data.continent,
          continent_code: data.continent_code,
          country: data.country,
          country_code: data.country_code,
          region: data.region,
          city: data.city,
          latitude: data.latitude,
          longitude: data.longitude,
          is_eu: data.is_eu,
          postal: data.postal,
          calling_code: data.calling_code,
          flag: data.flag,
          timezone: data.timezone,
        }
      } catch (err) {
        logger.error('getClientIpData failed', { eventName: 'GETCLIENTIPDATA_FAILED', err: err.message })
      }
    }

    const hostAsserted = source.channel === 'embed' && body.capturedVia === 'embed_identify'
    let fields = {}
    if (visitorName) fields = writeField(fields, 'name', visitorName, hostAsserted ? 'host' : 'self_reported') || fields
    if (visitorEmail) fields = writeField(fields, 'email', visitorEmail, hostAsserted ? 'host' : 'self_reported') || fields
    const personalization = parsePersonalization(body.personalization, visitorName, visitorEmail)
    if (personalization.company && body.personalization && body.personalization.company && hostAsserted) {
      fields = writeField(fields, 'company', personalization.company, 'host') || fields
    }

    // The chat still needs the session; only the rrweb replay is skipped
    const recordingDisabled = mode === 'published' && await isAnalyticsExcludedIp(clientIp, Models, agent.workspaceId)

    const session = await new Models.AgentSession({
      workspaceId: agent.workspaceId,
      agentId: agent._id,
      mode,
      recordingDisabled,
      visitorName,
      visitorEmail,
      visitorSessionId: short.uuid(),
      clientIpData,
      startTimestamp: moment().valueOf(),
      source,
      fields,
      personalization,
      ...(agent.recapEnabled !== false ? { recapToken: short.uuid() } : {}),
    }).save()

    await Models.AgentSessionEvent.create({
      sessionId: session._id,
      workspaceId: agent.workspaceId,
      agentId: agent._id,
      type: 'session_started',
      timestamp: session.startTimestamp,
      data: {},
    })

    if (mode === 'published' && (visitorName || visitorEmail)) {
      const capturedVia = source.channel === 'embed' && EMBED_CAPTURED_VIA.includes(body.capturedVia) ? body.capturedVia : 'form'
      const lead = await new Models.Lead({
        workspaceId: agent.workspaceId,
        agentId: agent._id,
        agentSessionId: session._id,
        data: { name: visitorName, email: visitorEmail },
        capturedVia,
      }).save()
      await Models.AgentSession.updateOne({ _id: session._id }, { $set: { leadId: lead._id } })
      session.leadId = lead._id
      if (visitorEmail) emitSafe(Models, agent.workspaceId, 'lead.created', sessionPayload({ session: session.toObject(), agent, lead: lead.toObject() }))
    }

    sendJson(res, {
      _id: session._id,
      visitorSessionId: session.visitorSessionId,
      leadId: session.leadId || null,
      recordingDisabled,
      personalization,
      personalizationVars: encodeVars(personalization),
      recapUrl: session.recapToken ? recapUrl(session) : null,
    })
  } catch (error) {
    sendError(res, error)
  }
}

export default handler
