import helpers from '../livedemoHelpers.js'
import ResponseCodes from '../../constants/ResponseCodes.js'
import thumbnailForScreen from '../agent/thumbnailForScreen.js'
import { httpError } from '../agent/http.js'
import { videoEmbed } from './normalizeShowcase.js'

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i

function notFound() {
    httpError(ResponseCodes['404_NOT_FOUND'], 'Showcase not found')
}

// Editor routes. Another workspace's showcase is a plain 404, same as loadAgentInWorkspace.
export async function loadShowcaseInWorkspace(Models, workspaceId, showcaseId) {
    if (!OBJECT_ID_RE.test(String(showcaseId))) notFound()
    const showcase = await Models.Showcase.findOne({
        _id: showcaseId,
        workspaceId,
        deletedAt: null
    })
    if (!showcase) notFound()
    return showcase
}

// Every public route: anonymous only when published, otherwise Bearer token + workspace member.
// Custom domains only serve their own workspace's showcases.
export async function loadPublicShowcase(req, Models, showcaseId) {
    if (!OBJECT_ID_RE.test(String(showcaseId))) notFound()
    const showcase = await Models.Showcase.findOne({ _id: showcaseId, deletedAt: null })
    if (!showcase) notFound()
    if (req.customDomainWorkspaceId && String(showcase.workspaceId) !== req.customDomainWorkspaceId) notFound()
    if (showcase.isPublished) return showcase

    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, showcase.workspaceId.toString())
    return showcase
}

// Stories without a thumbnail fall back to their first screen
async function storyThumbnails(Models, stories) {
    const missing = stories.filter(story => !story.thumbnailImageUrl).map(story => story._id)
    if (!missing.length) return

    const withScreens = await Models.Story.find({ _id: { $in: missing } })
        .select('screens')
        .populate({
            path: 'screens',
            select: '_id type imageUrl index asset',
            options: { sort: { index: 1 }, perDocumentLimit: 1 }
        })
        .lean()
    withScreens.forEach((doc) => {
        const story = stories.find(s => String(s._id) === String(doc._id))
        story.thumbnailImageUrl = thumbnailForScreen(doc.screens && doc.screens[0]) || ''
    })
}

// Items joined with their story / agent. 'published' keeps only what a visitor can play:
// no hidden items, no drafts, no deleted refs. 'editor' keeps all and flags them instead.
export async function resolveItems(Models, showcase, mode) {
    const items = (showcase.toObject ? showcase.toObject() : showcase).items || []
    const ids = field => items.map(item => item[field]).filter(Boolean)
    const [stories, agents] = await Promise.all([
        Models.Story.find({
            _id: { $in: ids('storyId') },
            workspaceId: showcase.workspaceId,
            deletedAt: null
        }).select('name thumbnailImageUrl isPublished mode sandbox.flows').lean(),
        Models.AiDemoAgent.find({
            _id: { $in: ids('agentId') },
            workspaceId: showcase.workspaceId,
            deletedAt: null
        }).select('name avatarUrl isPublished').lean()
    ])
    await storyThumbnails(Models, stories)
    const flowOf = (story, flowId) => flowId && story && story.mode === 'sandbox'
        ? ((story.sandbox && story.sandbox.flows) || []).find(flow => String(flow._id) === String(flowId))
        : null
    const flowStarts = items.map(item => flowOf(stories.find(s => String(s._id) === String(item.storyId)), item.flowId))
        .filter(flow => flow && flow.startScreenId)
        .map(flow => flow.startScreenId)
    const startScreens = flowStarts.length
        ? await Models.Screen.find({ _id: { $in: flowStarts } }).select('imageUrl').lean()
        : []

    return items.map((item) => {
        const story = item.storyId && stories.find(s => String(s._id) === String(item.storyId))
        const agent = item.agentId && agents.find(a => String(a._id) === String(item.agentId))
        // Unknown flow (deleted since) plays the whole sandbox
        const flow = flowOf(story, item.flowId)
        const flowThumb = flow && (startScreens.find(s => String(s._id) === String(flow.startScreenId)) || {}).imageUrl
        const video = item.kind === 'video' ? videoEmbed(item.url) : null
        const ref = story || agent
        const missing = (item.kind === 'demo' && !story) || (item.kind === 'agent' && !agent) || (item.kind === 'video' && !video)
        const draft = !!ref && !ref.isPublished
        if (mode !== 'editor' && (item.hidden || missing || draft)) return null

        return {
            _id: item._id,
            kind: item.kind,
            sectionId: item.sectionId || null,
            facetOptionIds: item.facetOptionIds || [],
            title: item.title || (flow && flow.name) || (ref && ref.name) || (item.kind === 'link' ? item.url : 'Untitled'),
            description: item.description || (flow && flow.description) || '',
            thumbnailUrl: item.thumbnailUrl || flowThumb || (story && story.thumbnailImageUrl) || (agent && agent.avatarUrl) || (video && video.thumbnailUrl) || '',
            ctaLabel: item.ctaLabel || '',
            estimatedMinutes: item.estimatedMinutes || (flow && flow.estimatedMinutes) || 0,
            storyId: item.storyId ? String(item.storyId) : null,
            flowId: flow ? String(flow._id) : null,
            restrictToFlow: !!flow && item.restrictToFlow !== false,
            agentId: item.agentId ? String(item.agentId) : null,
            url: item.kind === 'link' ? item.url : '',
            embedUrl: video ? video.embedUrl : '',
            ...(mode === 'editor' ? { hidden: !!item.hidden, draft, missing } : {})
        }
    }).filter(Boolean)
}

// Fields the player needs. No userId, tags, allowedDomains or seo internals.
export function publicShowcase(showcase) {
    const doc = showcase.toObject ? showcase.toObject() : showcase
    return {
        _id: String(doc._id),
        name: doc.name,
        workspaceId: String(doc.workspaceId),
        isPublished: !!doc.isPublished,
        layout: doc.layout,
        header: doc.header || {},
        theme: doc.theme || {},
        sections: doc.sections || [],
        facets: doc.facets || [],
        gallery: doc.gallery || {},
        playlist: doc.playlist || {},
        cta: doc.cta || {}
    }
}
