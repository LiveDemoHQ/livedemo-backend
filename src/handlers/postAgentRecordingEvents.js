import mongoose from 'mongoose'
import moment from 'moment'
import helpers from '../helpers/livedemoHelpers.js'
import loadPublicAgent from '../helpers/agent/loadPublicAgent.js'
import postStorySessionEventsValidator from '../helpers/validators/stories/sessions/events/postStorySessionEventsValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import ipRateLimit from '../helpers/agent/ipRateLimit.js'

const { ObjectId } = mongoose.Types

const MAX_EVENTS_PER_SESSION = 1000
const checkIpLimit = ipRateLimit({ limit: 5, interval: 60 * 60 * 1000, message: 'Too many recorded sessions, try again later' })

// POST /agents/:agentId/sessions/:agentSessionId/recording-events  { events }
// rrweb of the whole agent page (chat + demo iframe). Stored like demo
// recordings: one Session { type: 'agent', agentSessionId } + SessionEvents.
const handler = async function (req, res) {
  const { Models } = req.mongo
  const { agentId, agentSessionId } = req.params

  try {
    const agent = await loadPublicAgent(req, Models, agentId)
    const { events = [] } = helpers.validateBody(req.body, postStorySessionEventsValidator).value

    const agentSession = await Models.AgentSession.findOne({ _id: agentSessionId, agentId: agent._id }).lean()
    if (!agentSession) {
      httpError(ResponseCodes['404_NOT_FOUND'], 'Session not found')
    }
    if (agentSession.mode === 'editor') {
      httpError(ResponseCodes['400_BAD_REQUEST'], 'Editor sessions are not recorded')
    }
    if (agentSession.recordingDisabled) {
      httpError(ResponseCodes['403_FORBIDDEN'], 'Recording is disabled for this IP')
    }
    if (!events.length) return sendJson(res)

    // IP limit counts new recordings only; later flushes of the same one are free
    const existing = await Models.Session.exists({ type: 'agent', agentSessionId: agentSession._id })
    if (!existing) await checkIpLimit(req)

    // ponytail: two first-flushes racing can create two Session docs (no unique
    // index). Flushes are sequential every few seconds, so it does not happen in practice.
    const session = await Models.Session.findOneAndUpdate(
      { type: 'agent', agentSessionId: agentSession._id },
      {
        $setOnInsert: {
          type: 'agent',
          agentSessionId: agentSession._id,
          workspaceId: agent.workspaceId,
          clientIpData: agentSession.clientIpData,
          startTimestamp: agentSession.startTimestamp || moment().valueOf(),
        },
      },
      { upsert: true, new: true },
    ).lean()

    // Truncate at the cap: the replay just ends there, no gap mid-recording
    const kept = events.slice(0, MAX_EVENTS_PER_SESSION - (session.eventsCount || 0))
    if (!kept.length) {
      httpError(ResponseCodes['429_TOO_MANY_REQUESTS'], 'Recording limit reached')
    }

    const clicks = kept.filter(e => e.data && e.data.source === 2 && e.data.type === 2).length
    const lastTimestamp = kept[kept.length - 1].timestamp

    await Models.SessionEvent.insertMany(kept.map(event => ({
      _id: new ObjectId(),
      sessionId: session._id,
      workspaceId: agent.workspaceId,
      eventData: {
        data: JSON.stringify(event.data),
        timestamp: event.timestamp,
        type: event.type,
        dataSource: event.data && event.data.source,
        dataType: event.data && event.data.type,
      },
    })))

    await Models.Session.updateOne({ _id: session._id }, {
      $set: { endTimestamp: lastTimestamp, duration: lastTimestamp - session.startTimestamp },
      $inc: { eventsClickCount: clicks, eventsCount: kept.length },
    })

    sendJson(res)
  } catch (error) {
    sendError(res, error)
  }
}

export default handler
