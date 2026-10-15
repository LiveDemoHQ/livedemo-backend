import summarizeAgentSession from '../helpers/agent/sessionInsights.js'
import { deliverWebhook } from '../helpers/workspaceEvents.js'
import { recordLemonSliceClip } from '../helpers/agent/avatarVideo.js'

// monq jobs for the sales pipeline:
//   summarizeAgentSession { sessionId, final } — summary/topics/intent/unanswered (+ session.ended, HubSpot when final)
//   deliverWebhook { hookId, event }            — one signed POST / Slack message; throws → monq retries
//   recordLemonSliceClip { lemonsliceAvatarId } — ~6s idle clip of a custom avatar for the embed pill (~20s of work)

function processAgentSession(sharedConfig, params, callback) {
    const { Models } = sharedConfig

    return Promise.resolve()
        .then(async () => {
            if (params.lemonsliceAvatarId) return recordLemonSliceClip(Models, params.lemonsliceAvatarId)
            if (params.hookId) {
                const hook = await Models.WorkspaceWebhook.findOne({ _id: params.hookId, enabled: true }).lean()
                if (!hook) return
                return deliverWebhook(Models, hook, params.event)
            }
            return summarizeAgentSession(Models, { sessionId: params.sessionId, final: !!params.final })
        })
        .then(() => callback(null, {}))
        .catch((err) => {
            console.log('processAgentSession failed', JSON.stringify(params), err.message)
            callback(err)
        })
}

const config = {
    queueNames: ['agent-session'],
    jobNames: ['summarizeAgentSession', 'deliverWebhook', 'recordLemonSliceClip'],
    handler: processAgentSession
}

export default config
