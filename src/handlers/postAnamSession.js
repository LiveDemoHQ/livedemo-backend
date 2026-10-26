import loadPublicAgent from '../helpers/agent/loadPublicAgent.js'
import { avatarIsLive, isLemonSlice, createAnamSessionToken } from '../helpers/agent/anam.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import ipRateLimit from '../helpers/agent/ipRateLimit.js'
import { beginAvatarSession, failAvatarSession, anamSessionCap } from '../helpers/agent/avatarMinutes.js'

import logger from '../helpers/logger.js'

// Each token opens a billed Anam session
const checkIpLimit = ipRateLimit({ limit: 10, interval: 60 * 60 * 1000, message: 'Too many avatar sessions, try again later' })

// POST /agents/:agentId/anam-session — short-lived Anam token for the talking face.
// No workspace twin: the editor pane never opens a (billed) Anam session.
const handler = async function (req, res) {
    const { Models } = req.mongo
    let row

    try {
        const agent = await loadPublicAgent(req, Models, req.params.agentId)
        if (!avatarIsLive(agent) || isLemonSlice(agent)) {
            httpError(ResponseCodes['400_BAD_REQUEST'], 'Avatar is not enabled for this agent')
        }
        await checkIpLimit(req)

        const started = await beginAvatarSession(Models, agent, 'anam')
        row = started.row
        const sessionToken = await createAnamSessionToken(agent, started.access.apiKey, anamSessionCap(started.access))
        sendJson(res, {
            sessionToken,
            usageId: row._id,
            remainingSeconds: started.access.remainingSeconds
        })
    } catch (error) {
        if (row) await failAvatarSession(Models, row).catch(err => logger.error('[avatarMinutes] close failed', { eventName: 'CLOSE_FAILED', err: err.message }))
        sendError(res, error)
    }
}

export default handler
