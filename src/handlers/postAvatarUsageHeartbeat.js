import { sendJson, sendError } from '../helpers/agent/http.js'
import ipRateLimit from '../helpers/agent/ipRateLimit.js'
import {
    loadOpenUsage,
    touchUsage,
    usedSeconds,
    remainingSeconds,
    stopForLimit,
    enforced
} from '../helpers/agent/avatarMinutes.js'

const checkIpLimit = ipRateLimit({ limit: 600, interval: 60 * 60 * 1000, message: 'Too many avatar updates, try again later' })

// POST /agents/:agentId/avatar-usage/:usageId/heartbeat — bill the gap since the last ping.
const handler = async function (req, res) {
    const { Models } = req.mongo

    try {
        await checkIpLimit(req)
        const row = await loadOpenUsage(Models, req.params.agentId, req.params.usageId)
        if (!row) return sendJson(res, { stop: true })

        const now = new Date()
        const touched = await touchUsage(Models, row, now)
        if (!touched.applied) return sendJson(res, { stop: false })

        if (row.ownKey || !enforced()) return sendJson(res, { stop: false })

        const used = await usedSeconds(Models, row.workspaceId, row.period)
        const remaining = remainingSeconds(row.limitSeconds, used)
        if (remaining <= 0) {

            await stopForLimit(Models, row, now)
            return sendJson(res, { stop: true })
        }

        sendJson(res, { stop: false, remainingSeconds: remaining })
    } catch (error) {
        sendError(res, error)
    }
}

export default handler
