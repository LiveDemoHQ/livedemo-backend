import { cloneStoryDemo } from '../cloneStoryDemo.js'
import { checklistTargetIds, remapChecklistForClone } from '../checklist/checklist.js'
import { getAllowedDemos } from '../agent/validateActions.js'
import enqueueIndexAgentKnowledge from '../agent/enqueueIndexJob.js'
import { normalizeItems } from '../showcase/normalizeShowcase.js'
import { MAX_OWN_CLONE_STORIES } from './own.js'

// Copies for one "Make it yours" claim (OWNABLE_DEMOS_TECH_DESIGN.md §5). One ctx per claim, so a story
// reached from a showcase item, an agent and a checklist is copied once.

const TOO_LARGE = `Too large to claim (more than ${MAX_OWN_CLONE_STORIES} demos)`

export function newCloneCtx({ Models, userId, workspaceId, sourceWorkspaceId, claimId }) {
    return {
        Models,
        userId,
        workspaceId,
        sourceWorkspaceId,
        claimId,
        storyIdMap: new Map(), // old storyId -> new storyId
        stepIdMaps: new Map(), // old storyId -> Map(old stepId -> new stepId)
        flowIdMaps: new Map(), // old storyId -> Map(old flowId -> new flowId)
        agentIdMap: new Map(),
        deferredChecklists: [],
        showcaseIds: []
    }
}

// Roots plus every story their checklists point to, transitively. Read only (also backs preview-count).
// Task targets follow normalizeChecklist's rule: same workspace, not deleted, not sandbox
export async function storyClosure(Models, sourceWorkspaceId, rootIds, skip = new Set()) {
    const roots = new Set(rootIds.map(String))
    const seen = new Set()
    const queue = [...roots]
    const stories = []

    while (queue.length) {
        const id = queue.shift()
        if (seen.has(id) || skip.has(id)) continue
        seen.add(id)
        const story = await Models.Story.findOne({
            _id: id,
            workspaceId: sourceWorkspaceId,
            deletedAt: null,
            ...(roots.has(id) ? {} : { mode: { $ne: 'sandbox' } })
        }).select('_id mode sandbox.flows._id custom.checklist').lean()
        if (!story) continue

        stories.push(story)
        if (stories.length + skip.size > MAX_OWN_CLONE_STORIES) throw new Error(TOO_LARGE)
        queue.push(...checklistTargetIds(story.custom && story.custom.checklist))
    }
    return stories
}

// Phase 1: copy the closure. Checklists are stored as is and rewritten by finishStoryGraph
export async function cloneStoryGraphForUser(rootIds, ctx) {
    const skip = new Set(ctx.storyIdMap.keys())
    const stories = await storyClosure(ctx.Models, ctx.sourceWorkspaceId, rootIds, skip)

    for (const story of stories) {
        const result = await cloneStoryDemo(story._id, ctx.userId, ctx.workspaceId, ctx.Models, {
            nameSuffix: '',
            collect: true,
            deferChecklist: true,
            clonedFrom: { kind: 'story', id: story._id, claimId: ctx.claimId }
        })
        if (!result) continue

        const oldId = String(story._id)
        ctx.storyIdMap.set(oldId, result.newStoryId)
        ctx.stepIdMaps.set(oldId, result.stepIdMap)
        ctx.flowIdMaps.set(oldId, result.flowIdMap)
        if (story.custom && story.custom.checklist) ctx.deferredChecklists.push({ newStoryId: result.newStoryId, checklist: story.custom.checklist })
    }
}

// Phase 2, once every story of the claim exists
export async function finishStoryGraph(ctx) {
    for (const { newStoryId, checklist } of ctx.deferredChecklists) {
        await ctx.Models.Story.updateOne({ _id: newStoryId }, { $set: { 'custom.checklist': remapChecklistForClone(checklist, ctx) } })
    }
    ctx.deferredChecklists = []
}

// The claimer never sees a partial copy
export async function rollbackClaim(ctx) {
    const deletedAt = new Date()
    const { Models } = ctx
    await Models.Story.updateMany({ _id: { $in: [...ctx.storyIdMap.values()] } }, { $set: { deletedAt } })
    await Models.AiDemoAgent.updateMany({ _id: { $in: [...ctx.agentIdMap.values()] } }, { $set: { deletedAt } })
    await Models.Showcase.updateMany({ _id: { $in: ctx.showcaseIds } }, { $set: { deletedAt } })
}

const mapStory = (ctx, id) => (id ? ctx.storyIdMap.get(String(id)) || null : null)

// Knowledge sources a claim may copy: never sales-call transcripts; demo sources are rebuilt for the copied stories
const COPYABLE_KNOWLEDGE = ['text', 'file', 'url', 'faq', 'site']

async function cloneKnowledge(Models, sourceAgentId, newAgent) {
    const sources = await Models.AgentKnowledgeSource.find({ agentId: sourceAgentId, type: { $in: COPYABLE_KNOWLEDGE } }).lean()
    const ids = []
    for (const source of sources) {
        const { _id, createdAt, updatedAt, ...data } = source
        const copy = await new Models.AgentKnowledgeSource({
            ...data,
            agentId: newAgent._id,
            workspaceId: newAgent.workspaceId
        }).save()
        ids.push(copy._id)

        // Embeddings are reused: no re-embedding cost
        const chunks = await Models.AgentKnowledgeChunk.find({ sourceId: _id, agentId: sourceAgentId }).lean()
        if (chunks.length) {

            await Models.AgentKnowledgeChunk.insertMany(chunks.map(({ _id: chunkId, createdAt: chunkCreatedAt, ...chunk }) => ({
                ...chunk,
                agentId: newAgent._id,
                workspaceId: newAgent.workspaceId,
                sourceId: copy._id
            })))
        }
    }
    return ids
}

// Same per-demo knowledge sources patchAgent creates for allowedDemoIds
async function createDemoSources(Models, newAgent) {
    const stories = await Models.Story.find({ _id: { $in: newAgent.allowedDemoIds } }).select('_id name').lean()
    const ids = []
    for (const story of stories) {
        const source = await new Models.AgentKnowledgeSource({
            agentId: newAgent._id,
            workspaceId: newAgent.workspaceId,
            type: 'demo',
            title: `${story.name || 'Untitled demo'} — auto from demo`,
            demoId: story._id,
            status: 'pending'
        }).save()
        ids.push(source._id)
    }
    return ids
}

// Empty allowedDemoIds = "all published stories": materialized, so the copy never means "all stories of the new workspace"
export async function agentDemoIds(Models, agent) {
    const allowed = (await getAllowedDemos(Models, agent, 'published')).map(story => String(story._id))
    const preview = (agent.embed && agent.embed.preview) || {}
    return [...new Set([...allowed.slice(0, MAX_OWN_CLONE_STORIES), agent.defaultDemoId, preview.demoId].filter(Boolean).map(String))]
}

export async function cloneAgentForUser(sourceAgentId, ctx, { includeKnowledge = false } = {}) {
    const { Models } = ctx
    const known = ctx.agentIdMap.get(String(sourceAgentId))
    if (known) return known

    const agent = await Models.AiDemoAgent.findOne({ _id: sourceAgentId, workspaceId: ctx.sourceWorkspaceId, deletedAt: null }).lean()
    if (!agent) return null

    const demoIds = await agentDemoIds(Models, agent)
    const preview = (agent.embed && agent.embed.preview) || {}
    await cloneStoryGraphForUser(demoIds, ctx)

    const {
        _id,
        createdAt,
        updatedAt,
        ownable,
        clonedFrom,
        links,
        tags,
        knowledgeSourceIds,
        ...data
    } = agent
    const isLemonSlice = agent.avatarProvider === 'lemonslice'
    const { lastSeen, ...embed } = agent.embed || {}

    const newAgent = await new Models.AiDemoAgent({
        ...data,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        isPublished: false,
        allowedDemoIds: demoIds.map(id => mapStory(ctx, id)).filter(Boolean),
        defaultDemoId: mapStory(ctx, agent.defaultDemoId),
        knowledgeSourceIds: [],
        tags: [],
        links: [],
        embed: {
            ...embed,
            enabled: false,
            allowedDomains: [],
            preview: { ...preview, demoId: mapStory(ctx, preview.demoId) }
        },
        // The author's company links
        cta: { ...agent.cta, bookMeetingUrl: '', startTrialUrl: '' },
        summaryEmail: { ...agent.summaryEmail, enabled: false },
        // LemonSlice avatars belong to the author's workspace
        ...(isLemonSlice ? { avatarProvider: 'anam', lemonsliceAvatarId: '', avatarVideoUrl: '' } : {}),
        clonedFrom: { kind: 'agent', id: agent._id, claimId: ctx.claimId },
        deletedAt: null
    }).save()
    ctx.agentIdMap.set(String(agent._id), newAgent._id)

    const sourceIds = [
        ...(includeKnowledge ? await cloneKnowledge(Models, agent._id, newAgent) : []),
        ...await createDemoSources(Models, newAgent)
    ]
    await Models.AiDemoAgent.updateOne({ _id: newAgent._id }, { $set: { knowledgeSourceIds: sourceIds } })
    enqueueIndexAgentKnowledge(newAgent._id).catch(err => console.log('[cloneAgentForUser] enqueue reindex failed', err))
    return newAgent._id
}

export async function cloneShowcaseForUser(sourceShowcaseId, ctx) {
    const { Models } = ctx
    const showcase = await Models.Showcase.findOne({ _id: sourceShowcaseId, workspaceId: ctx.sourceWorkspaceId, deletedAt: null }).lean()
    if (!showcase) return null
    const items = showcase.items || []

    // Agents first, then all demo items in one graph; includeKnowledge follows each agent's own ownable setting
    for (const item of items.filter(i => i.kind === 'agent' && i.agentId)) {
        const agent = await Models.AiDemoAgent.findOne({ _id: item.agentId }).select('ownable').lean()
        await cloneAgentForUser(item.agentId, ctx, { includeKnowledge: !!(agent && agent.ownable && agent.ownable.includeKnowledge) })
    }
    await cloneStoryGraphForUser(items.filter(i => i.kind === 'demo' && i.storyId).map(i => i.storyId), ctx)

    const remapped = items.flatMap((item) => {
        if (item.kind === 'demo') {
            const storyId = mapStory(ctx, item.storyId)
            if (!storyId) return []
            let flowId = item.flowId
            if (flowId) {

                const newFlowId = (ctx.flowIdMaps.get(String(item.storyId)) || new Map()).get(String(flowId))
                if (!newFlowId) throw new Error(`Sandbox flow of "${item.title || 'a demo'}" could not be copied`)
                flowId = String(newFlowId)
            }
            return [{ ...item, storyId: String(storyId), flowId }]
        }
        if (item.kind === 'agent') {
            const agentId = item.agentId && ctx.agentIdMap.get(String(item.agentId))
            return agentId ? [{ ...item, agentId: String(agentId) }] : []
        }
        return [item]
    })
    // Same validation as an editor save, against the new workspace. Passing the items as "saved" skips
    // the link DNS check and the flow lookup (flows were checked above)
    const checkedItems = await normalizeItems(Models, ctx.workspaceId, remapped, showcase.sections || [], showcase.facets || [], remapped)

    const {
        _id,
        createdAt,
        updatedAt,
        ownable,
        clonedFrom,
        tags,
        ...data
    } = showcase
    const copy = await new Models.Showcase({
        ...data,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        isPublished: false,
        items: checkedItems,
        tags: [],
        embed: { ...showcase.embed, enabled: false, allowedDomains: [] },
        seo: { ...showcase.seo, noindex: true },
        cta: { ...showcase.cta, url: '' },
        clonedFrom: { kind: 'showcase', id: showcase._id, claimId: ctx.claimId },
        deletedAt: null
    }).save()
    ctx.showcaseIds.push(copy._id)
    return copy._id
}

// What a claim of doc would copy, without writing. Backs the editor count and the enable check
export async function ownablePreviewCount(Models, kind, doc) {
    const roots = kind === 'story' ? [String(doc._id)] : []
    let agents = 0
    if (kind === 'agent') {

        roots.push(...await agentDemoIds(Models, doc))
    } else if (kind === 'showcase') {

        const items = doc.items || []
        const agentIds = [...new Set(items.filter(i => i.kind === 'agent' && i.agentId).map(i => String(i.agentId)))]
        const agentDocs = await Models.AiDemoAgent.find({ _id: { $in: agentIds }, workspaceId: doc.workspaceId, deletedAt: null }).lean()
        agents = agentDocs.length
        for (const agent of agentDocs) roots.push(...await agentDemoIds(Models, agent))
        roots.push(...items.filter(i => i.kind === 'demo' && i.storyId).map(i => String(i.storyId)))
    }

    const rootSet = new Set(roots)
    try {
        const stories = await storyClosure(Models, doc.workspaceId, [...rootSet])
        return {
            stories: stories.length,
            fromChecklist: stories.filter(s => !rootSet.has(String(s._id))).length,
            sandboxFlows: stories.reduce((sum, s) => sum + ((s.sandbox && s.sandbox.flows) || []).length, 0),
            agents,
            max: MAX_OWN_CLONE_STORIES,
            tooLarge: false
        }
    } catch (err) {
        if (err.message !== TOO_LARGE) throw err
        return {
            stories: MAX_OWN_CLONE_STORIES + 1,
            fromChecklist: 0,
            sandboxFlows: 0,
            agents,
            max: MAX_OWN_CLONE_STORIES,
            tooLarge: true
        }
    }
}

// The worker's single entry point. Returns the root copy's id
export async function cloneForClaim(kind, sourceId, ctx, source) {
    try {
        let clonedId = null
        if (kind === 'story') {

            await cloneStoryGraphForUser([sourceId], ctx)
            clonedId = mapStory(ctx, sourceId)
        } else if (kind === 'agent') {

            clonedId = await cloneAgentForUser(sourceId, ctx, { includeKnowledge: source.includeKnowledge })
        } else {

            clonedId = await cloneShowcaseForUser(sourceId, ctx)
        }
        if (!clonedId) throw new Error('This is no longer claimable')
        await finishStoryGraph(ctx)
        return clonedId
    } catch (err) {
        await rollbackClaim(ctx).catch(rollbackErr => console.error('[cloneForClaim] rollback failed', rollbackErr))
        throw err
    }
}
