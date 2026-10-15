import summarizeAgentSession from '../helpers/agent/sessionInsights.js'
import { deliverWebhook } from '../helpers/workspaceEvents.js'

// monq jobs for the sales pipeline:
//   summarizeAgentSession { sessionId, final } — summary/topics/intent/unanswered (+ session.ended, HubSpot when final)
//   deliverWebhook { hookId, event }            — one signed POST / Slack message; throws → monq retries

function processAgentSession(sharedConfig, params, callback) {
    const { Models } = sharedConfig

    return Promise.resolve()
        .then(async () => {
            if (params.hookId) {
                const hook = await Models.WorkspaceWebhook.findOne({ _id: params.hookId, enabled: true }).lean()
                if (!hook) return
                return deliverWebhook(Models, hook, params.event)
            }
            return summarizeAgentSession(Models, { sessionId: params.sessionId, final: !!params.final })
        })
        .then(() => callback(null, {}))
        .catch((err) => {
            console.log('processAgentSession failed', err.message)
            callback(err)
        })
}

const config = {
    queueNames: ['agent-session'],
    jobNames: ['summarizeAgentSession', 'deliverWebhook'],
    handler: processAgentSession
}

export default config
