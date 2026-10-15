import loadPublicAgent from '../helpers/agent/loadPublicAgent.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import moment from 'moment'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import enqueueJob from '../helpers/enqueueJob.js'
import { emitSafe, sessionPayload } from '../helpers/workspaceEvents.js'

// POST /agents/:agentId/ack  { sessionId, type, data }
// Client-side facts the server can't infer: demo_opened, step_viewed,
// suggestion_clicked, cta_clicked, session_ended (hang-up), calendar_opened,
// meeting_booked (Calendly / Cal.com postMessage from the inline calendar).
const ACK_TYPES = [
  'demo_opened', 'step_viewed', 'suggestion_clicked', 'cta_clicked',
  'voice_started', 'voice_completed', 'session_ended', 'calendar_opened', 'meeting_booked',
]

const handler = async function (req, res) {
  const { Models } = req.mongo
  const agentId = req.params.agentId
  const body = req.body || {}

  try {
    const agent = await loadPublicAgent(req, Models, agentId)

    if (!ACK_TYPES.includes(body.type)) {
      httpError(ResponseCodes['400_BAD_REQUEST'], 'Invalid event type')
    }

    const session = await Models.AgentSession.findOne({
      _id: body.sessionId,
      agentId: agent._id,
    }).lean()
    if (!session) {
      httpError(ResponseCodes['404_NOT_FOUND'], 'Session not found')
    }

    const timestamp = moment().valueOf()

    await Models.AgentSessionEvent.create({
      sessionId: session._id,
      workspaceId: agent.workspaceId,
      agentId: agent._id,
      type: body.type,
      timestamp,
      data: body.data || {},
    })

    if (body.type === 'cta_clicked') {
      await Models.AgentSession.updateOne({ _id: session._id }, { $inc: { ctaClickCount: 1 } })
    }

    if (body.type === 'demo_opened' || body.type === 'step_viewed') {
      const demoId = body.data && body.data.demoId
      const stepNumber = body.data && body.data.stepNumber
      if (demoId) {
        await Models.AgentSession.updateOne({ _id: session._id }, {
          $set: {
            currentDemoId: demoId,
            ...(stepNumber != null ? { currentStepNumber: Number(stepNumber) || 1 } : {}),
            stage: 'demo',
          },
          $addToSet: { viewedDemoIds: demoId },
        })
      }
    }

    if (body.type === 'session_ended') {
      await Models.AgentSession.updateOne({ _id: session._id }, {
        $set: {
          endTimestamp: timestamp,
          duration: timestamp - (session.startTimestamp || timestamp),
          stage: 'ended',
        },
      })
      if (session.mode === 'published') {
        const claimed = await Models.AgentSession.updateOne({ _id: session._id, finalizeQueuedAt: null }, { $set: { finalizeQueuedAt: new Date() } })
        if (claimed.modifiedCount) await enqueueJob('agent-session', 'summarizeAgentSession', { sessionId: String(session._id), final: true })
      }
    }

    // ponytail: booking is client-reported (the Calendly/Cal.com event arrives in the browser);
    // verify via their webhooks/API if bookings ever drive billing. Once per session.
    if (body.type === 'meeting_booked' && !session.meetingBookedAt) {
      const now = new Date()
      const updated = await Models.AgentSession.findOneAndUpdate(
        { _id: session._id, meetingBookedAt: null },
        { $set: { meetingBookedAt: now, stage: 'booked' } },
        { new: true, lean: true }
      )
      if (updated && session.mode === 'published') {
        const lead = session.leadId ? await Models.Lead.findOneAndUpdate({ _id: session.leadId }, { $set: { meetingBookedAt: now } }, { new: true, lean: true }) : null
        emitSafe(Models, agent.workspaceId, 'meeting.booked', sessionPayload({ session: updated, agent, lead }))
      }
    }

    sendJson(res)
  } catch (error) {
    sendError(res, error)
  }
}

export default handler
