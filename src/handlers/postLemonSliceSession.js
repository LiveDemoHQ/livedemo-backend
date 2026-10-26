import loadPublicAgent from '../helpers/agent/loadPublicAgent.js'
import { avatarIsLive, isLemonSlice } from '../helpers/agent/anam.js'
import { createLemonSliceSession } from '../helpers/agent/lemonslice.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import ipRateLimit from '../helpers/agent/ipRateLimit.js'
import { beginAvatarSession, failAvatarSession } from '../helpers/agent/avatarMinutes.js'

import logger from '../helpers/logger.js'

// Each call starts a billed LemonSlice session
const checkIpLimit = ipRateLimit({ limit: 10, interval: 60 * 60 * 1000, message: 'Too many avatar sessions, try again later' })

// POST /agents/:agentId/lemonslice-session — LiveKit room + token for the talking face.
// No workspace twin: the editor pane never opens a (billed) avatar session.
const handler = async function (req, res) {
    const { Models } = req.mongo
    let row

    try {
        const agent = await loadPublicAgent(req, Models, req.params.agentId)
        if (!avatarIsLive(agent) || !isLemonSlice(agent)) {
            httpError(ResponseCodes['400_BAD_REQUEST'], 'Avatar is not enabled for this agent')
        }
        await checkIpLimit(req)

        const started = await beginAvatarSession(Models, agent, 'lemonslice')
        row = started.row
        const session = await createLemonSliceSession(Models, agent, started.access.apiKey)
        row.controlUrl = session.controlUrl
        await Models.AvatarUsage.updateOne({ _id: row._id }, { $set: { room: session.room, controlUrl: session.controlUrl } })
        sendJson(res, {
            livekitUrl: session.livekitUrl,
            token: session.token,
            avatarIdentity: session.avatarIdentity,
            usageId: row._id,
            remainingSeconds: started.access.remainingSeconds
        })
    } catch (error) {
        if (row) await failAvatarSession(Models, row).catch(err => logger.error('[avatarMinutes] close failed', { eventName: 'CLOSE_FAILED', err: err.message }))
        sendError(res, error)
    }
}

export default handler
