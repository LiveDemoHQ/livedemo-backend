import enqueueIndexAgentKnowledge from './enqueueIndexJob.js'

import logger from '../logger.js'

// Same-workspace duplicate. Sessions, revisions, share links and "Make it yours"
// settings stay behind. Knowledge chunks are copied so the duplicate can answer
// immediately; a source still indexing is re-queued instead.

const DROP = [
    '_id',
    'createdAt',
    'updatedAt',
    '__v',
    'ownable',
    'clonedFrom',
    'links',
    'knowledgeSourceIds',
    'deletedAt',
    'isPublished',
]

const NAME_MAX = 200

export function agentCopyPayload(agent, { name, userId } = {}) {
    const data = { ...agent }
    DROP.forEach((key) => {
        delete data[key]
    })

    const requested = typeof name === 'string' ? name.trim() : ''
    const base = requested || `${(agent.name || '').trim() || 'Untitled agent'} (2)`

    return {
        ...data,
        name: base.slice(0, NAME_MAX),
        userId,
        workspaceId: agent.workspaceId,
        isPublished: false,
        links: [],
        knowledgeSourceIds: [],
        deletedAt: null,
    }
}

async function removePartialCopy(Models, agentId) {
    await Models.AgentKnowledgeChunk.deleteMany({ agentId })
    await Models.AgentKnowledgeSource.deleteMany({ agentId })
    await Models.AiDemoAgent.deleteOne({ _id: agentId })
}

export async function copyAgent(Models, agent, { name, userId } = {}) {
    const newAgent = await new Models.AiDemoAgent(agentCopyPayload(agent, { name, userId })).save()

    try {
        const sources = await Models.AgentKnowledgeSource.find({ agentId: agent._id }).lean()
        const sourceIds = []
        const needsIndex = []

        for (const source of sources) {
            const { _id, createdAt, updatedAt, __v, ...data } = source
            const busy = source.status === 'pending' || source.status === 'indexing'
            const copy = await new Models.AgentKnowledgeSource({
                ...data,
                agentId: newAgent._id,
                workspaceId: newAgent.workspaceId,
                ...(busy ? { status: 'pending', errorMessage: '' } : {}),
            }).save()
            sourceIds.push(copy._id)

            if (busy) {
                needsIndex.push(copy._id)
                continue
            }

            const chunks = await Models.AgentKnowledgeChunk.find({ sourceId: _id, agentId: agent._id }).lean()
            if (chunks.length) {

                await Models.AgentKnowledgeChunk.insertMany(chunks.map(({ _id: chunkId, createdAt: chunkCreatedAt, __v: chunkV, ...chunk }) => ({
                    ...chunk,
                    agentId: newAgent._id,
                    workspaceId: newAgent.workspaceId,
                    sourceId: copy._id,
                })))
            }
        }

        if (sourceIds.length) {

            await Models.AiDemoAgent.updateOne({ _id: newAgent._id }, { $set: { knowledgeSourceIds: sourceIds } })
        }

        needsIndex.forEach((sourceId) => {
            enqueueIndexAgentKnowledge(newAgent._id, sourceId)
                .catch(err => logger.error('enqueue reindex failed', { eventName: 'ENQUEUE_REINDEX_FAILED', err }))
        })

        return newAgent
    } catch (err) {
        await removePartialCopy(Models, newAgent._id)
        throw err
    }
}
