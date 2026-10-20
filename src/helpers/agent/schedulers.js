import enqueueJob from '../enqueueJob.js'
import enqueueIndexAgentKnowledge from './enqueueIndexJob.js'
import { closeStaleAvatarUsage } from './avatarMinutes.js'

// Timers for the jobs-server process (setup.js). Each tick claims rows with a
// conditional update before enqueueing, so overlapping ticks never double-queue.
// ponytail: plain setInterval in one worker; move to a cron/lock if we run several job servers.

const MIN_IDLE_MS = 5 * 60 * 1000
const SWEEP_MS = 60 * 1000
const RECRAWL_TICK_MS = 60 * 60 * 1000

// Most visitors close the tab instead of hanging up: finalize sessions idle for the agent's
// summaryIdleMinutes (default 5)
export async function finalizeIdleSessions(Models) {
    const now = new Date()
    const candidates = await Models.AgentSession.aggregate([
        {
            $match: {
                mode: 'published',
                finalizeQueuedAt: null,
                updatedAt: { $lt: new Date(now - MIN_IDLE_MS) },
                startTimestamp: { $gt: Date.now() - 3 * 24 * 60 * 60 * 1000 }
            }
        },
        {
            $lookup: {
                from: Models.AiDemoAgent.collection.name,
                let: { agentId: '$agentId' },
                pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$agentId'] } } }, { $project: { summaryIdleMinutes: 1 } }],
                as: 'agent'
            }
        },
        { $match: { $expr: { $lt: ['$updatedAt', { $subtract: [now, { $multiply: [{ $ifNull: [{ $arrayElemAt: ['$agent.summaryIdleMinutes', 0] }, 5] }, 60000] }] }] } } },
        { $limit: 200 },
        { $project: { _id: 1 } }
    ])

    for (const { _id } of candidates) {
        const claimed = await Models.AgentSession.updateOne({ _id, finalizeQueuedAt: null }, { $set: { finalizeQueuedAt: new Date() } })
        if (claimed.modifiedCount) await enqueueJob('agent-session', 'summarizeAgentSession', { sessionId: String(_id), final: true })
    }
}

export async function recrawlStaleSources(Models) {
    const sources = await Models.AgentKnowledgeSource.find({
        type: { $in: ['site', 'url'] },
        enabled: { $ne: false },
        status: { $in: ['ready', 'error'] },
        refreshHours: { $gt: 0 },
        $expr: { $lt: [{ $ifNull: ['$lastCrawledAt', new Date(0)] }, { $subtract: [new Date(), { $multiply: ['$refreshHours', 3600000] }] }] }
    }).select('_id agentId status').limit(100).lean()

    for (const source of sources) {
        const claimed = await Models.AgentKnowledgeSource.updateOne({ _id: source._id, status: source.status }, { $set: { status: 'pending' } })
        if (claimed.modifiedCount) await enqueueIndexAgentKnowledge(source.agentId, source._id)
    }
}

export default function startAgentSchedulers(Models) {
    const run = (name, fn) => () => fn(Models).catch(err => console.log(`${name} failed`, err.message))
    setInterval(run('finalizeIdleSessions', finalizeIdleSessions), SWEEP_MS)
    setInterval(run('closeStaleAvatarUsage', closeStaleAvatarUsage), SWEEP_MS)
    setInterval(run('recrawlStaleSources', recrawlStaleSources), RECRAWL_TICK_MS)
}
