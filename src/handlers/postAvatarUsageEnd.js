import { sendJson, sendError } from '../helpers/agent/http.js'
import ipRateLimit from '../helpers/agent/ipRateLimit.js'
import { loadOpenUsage, touchUsage, terminateUsage } from '../helpers/agent/avatarMinutes.js'

const checkIpLimit = ipRateLimit({ limit: 600, interval: 60 * 60 * 1000, message: 'Too many avatar updates, try again later' })

// POST /agents/:agentId/avatar-usage/:usageId/end — visitor left. sendBeacon sends text/plain; the body is ignored.
const handler = async function (req, res) {
    const { Models } = req.mongo

    try {
        await checkIpLimit(req)
        const row = await loadOpenUsage(Models, req.params.agentId, req.params.usageId)
        if (!row) return sendJson(res, { stop: true })

        const touched = await touchUsage(Models, row, new Date(), 'client')
        if (touched.applied) await terminateUsage(Models, row)
        sendJson(res, { stop: true })
    } catch (error) {
        sendError(res, error)
    }
}

export default handler
