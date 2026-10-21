import short from 'short-uuid'
import ResponseCodes from '../../constants/ResponseCodes.js'
import { httpError } from '../agent/http.js'
import { normalizeAllowedDomains, canRemoveBranding } from '../agent/embed.js'
import { assertPublicUrl } from '../agent/publicUrl.js'

// PATCH body -> $set updates for a Showcase. Whitelist only, never the raw body.
// Item refs must be live stories / agents of the showcase's own workspace.

const MAX_ITEMS = 100
const MAX_SECTIONS = 20
const MAX_FACETS = 10
const MAX_OPTIONS = 30
const KINDS = ['demo', 'agent', 'video', 'link']
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i
const COLOR_RE = /^#[0-9a-f]{6}$/i

// Hosts the player may frame for video items. Also the player CSP frame-src.
export const VIDEO_FRAME_SRC = 'https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com https://fast.wistia.net'

function bad(message) {
    httpError(ResponseCodes['400_BAD_REQUEST'], message)
}

function text(value, max, label) {
    if (value === undefined || value === null) return ''
    if (typeof value !== 'string' || value.length > max) bad(`${label} must be text up to ${max} characters`)
    return value.trim()
}

const str = max => (value, label) => text(value, max, label)

function bool(value, label) {
    if (typeof value !== 'boolean') bad(`${label} must be true or false`)
    return value
}

const oneOf = values => (value, label) => {
    if (!values.includes(value)) bad(`${label} must be one of ${values.join(', ')}`)
    return value
}

// Interpolated into the player's CSS
const color = allowEmpty => (value, label) => {
    if (!(allowEmpty && value === '') && !COLOR_RE.test(String(value))) bad(`${label} must be #rrggbb`)
    return value
}

const int = (min, max) => (value, label) => {
    if (!Number.isInteger(value) || value < min || value > max) bad(`${label} must be a whole number from ${min} to ${max}`)
    return value
}

// Only rendered as <img src>, so the scheme is all that matters
function image(value, label) {
    const url = text(value, 1000, label)
    if (url && !/^https:\/\/[^\s"'<>]+$/i.test(url)) bad(`${label} must be an https URL`)
    return url
}

const GROUPS = {
    header: { title: str(120), subtitle: str(300), logoUrl: image },
    theme: {
        mode: oneOf(['light', 'dark']),
        accentColor: color(false),
        backgroundColor: color(true),
        cardStyle: oneOf(['thumbnail', 'compact'])
    },
    seo: { title: str(120), description: str(300), noindex: bool },
    gallery: { showSearch: bool, showFilters: bool, columns: int(1, 4) },
    playlist: { autoplayNext: bool, showProgress: bool, checklist: bool },
    cta: { label: str(40) },
    embed: { enabled: bool, showBranding: bool }
}

// Pasted share URL -> { embedUrl, thumbnailUrl }, or null when the provider is not supported
export function videoEmbed(raw) {
    let url
    try {
        url = new URL(String(raw || '').trim())
    } catch {
        return null
    }
    if (url.protocol !== 'https:') return null
    const host = url.hostname.replace(/^www\./, '')
    const path = url.pathname.split('/').filter(Boolean)
    const safe = id => (/^[A-Za-z0-9_-]{4,64}$/.test(id || '') ? id : null)

    if (['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
        const id = safe(host === 'youtu.be' ? path[0] : ['embed', 'shorts', 'live'].includes(path[0]) ? path[1] : url.searchParams.get('v'))
        return id ? { embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0&autoplay=1`, thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } : null
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
        const id = path.find(part => /^\d{4,}$/.test(part))
        return id ? { embedUrl: `https://player.vimeo.com/video/${id}?autoplay=1`, thumbnailUrl: '' } : null
    }
    if (host === 'loom.com') {
        const id = safe(['share', 'embed'].includes(path[0]) ? path[1] : null)
        return id ? { embedUrl: `https://www.loom.com/embed/${id}?autoplay=1`, thumbnailUrl: '' } : null
    }
    if (host === 'wistia.com' || host.endsWith('.wistia.com') || host === 'fast.wistia.net') {
        const index = path.findIndex(part => ['medias', 'iframe'].includes(part))
        const id = safe(index >= 0 ? path[index + 1] : null)
        return id ? { embedUrl: `https://fast.wistia.net/embed/iframe/${id}?autoPlay=true`, thumbnailUrl: '' } : null
    }
    return null
}

// Keeps client ids (stable deep links) unless missing, malformed or duplicated
function idPicker() {
    const seen = new Set()
    return (raw) => {
        const id = ID_RE.test(String(raw || '')) && !seen.has(String(raw)) ? String(raw) : short.generate()
        seen.add(id)
        return id
    }
}

function asObject(raw) {
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
}

export function normalizeSections(list) {
    if (!Array.isArray(list)) bad('sections must be an array')
    if (list.length > MAX_SECTIONS) bad(`Up to ${MAX_SECTIONS} sections`)
    const pickId = idPicker()
    return list.map((raw, i) => {
        const section = asObject(raw)
        return {
            _id: pickId(section._id),
            title: text(section.title, 120, `sections[${i}].title`),
            description: text(section.description, 300, `sections[${i}].description`)
        }
    })
}

export function normalizeFacets(list) {
    if (!Array.isArray(list)) bad('facets must be an array')
    if (list.length > MAX_FACETS) bad(`Up to ${MAX_FACETS} filters`)
    const pickId = idPicker()
    return list.map((raw, i) => {
        const facet = asObject(raw)
        const options = Array.isArray(facet.options) ? facet.options : []
        if (options.length > MAX_OPTIONS) bad(`Up to ${MAX_OPTIONS} options per filter`)
        return {
            _id: pickId(facet._id),
            name: text(facet.name, 40, `facets[${i}].name`),
            options: options.map((option, j) => ({
                _id: pickId(asObject(option)._id),
                name: text(asObject(option).name, 40, `facets[${i}].options[${j}].name`)
            }))
        }
    })
}

// Drops section / facet option ids that no longer exist
export function relinkItems(items, sections, facets) {
    const sectionIds = new Set(sections.map(section => String(section._id)))
    const optionIds = new Set(facets.flatMap(facet => (facet.options || []).map(option => String(option._id))))
    return items.map(item => ({
        ...item,
        sectionId: item.sectionId && sectionIds.has(String(item.sectionId)) ? String(item.sectionId) : null,
        facetOptionIds: (item.facetOptionIds || []).map(String).filter(id => optionIds.has(id))
    }))
}

async function assertInWorkspace(Model, items, field, workspaceId, label) {
    const ids = [...new Set(items.map(item => item[field]).filter(Boolean))]
    if (!ids.length) return
    const found = await Model.find({
        _id: { $in: ids },
        workspaceId,
        deletedAt: null
    }).select('_id').lean()
    if (found.length !== ids.length) bad(`Every ${label} must belong to this workspace`)
}

// New flow items must point at an existing flow of a sandbox story. Runs after assertInWorkspace.
// Saved ones are skipped: a flow deleted later plays as the whole sandbox and must not block other edits.
async function assertFlows(Models, items, currentItems) {
    const saved = new Set(currentItems.filter(item => item.flowId).map(item => `${item.storyId}:${item.flowId}`))
    const flowItems = items.filter(item => item.flowId && !saved.has(`${item.storyId}:${item.flowId}`))
    if (!flowItems.length) return
    const stories = await Models.Story.find({ _id: { $in: [...new Set(flowItems.map(item => item.storyId))] } })
        .select('mode sandbox.flows._id')
        .lean()
    items.forEach((item, i) => {
        if (!flowItems.includes(item)) return
        const story = stories.find(s => String(s._id) === item.storyId)
        if (!story || story.mode !== 'sandbox') bad(`items[${i}].flowId is only allowed on sandbox demos`)
        if (!((story.sandbox && story.sandbox.flows) || []).some(flow => String(flow._id) === item.flowId)) bad(`items[${i}].flowId not found`)
    })
}

export async function normalizeItems(Models, workspaceId, list, sections, facets, currentItems = []) {
    if (!Array.isArray(list)) bad('items must be an array')
    if (list.length > MAX_ITEMS) bad(`Up to ${MAX_ITEMS} items`)
    const pickId = idPicker()
    // Links already saved were checked then; skip the DNS lookup on unrelated saves
    const savedLinks = new Set(currentItems.filter(item => item.kind === 'link').map(item => item.url))

    const items = await Promise.all(list.map(async (raw, i) => {
        const item = asObject(raw)
        const label = `items[${i}]`
        if (!KINDS.includes(item.kind)) bad(`${label}.kind must be one of ${KINDS.join(', ')}`)
        const minutes = item.estimatedMinutes === undefined ? 0 : item.estimatedMinutes
        const out = {
            _id: pickId(item._id),
            kind: item.kind,
            sectionId: item.sectionId ? String(item.sectionId) : null,
            storyId: null,
            agentId: null,
            url: '',
            title: text(item.title, 120, `${label}.title`),
            description: text(item.description, 300, `${label}.description`),
            thumbnailUrl: image(item.thumbnailUrl, `${label}.thumbnailUrl`),
            ctaLabel: text(item.ctaLabel, 40, `${label}.ctaLabel`),
            facetOptionIds: Array.isArray(item.facetOptionIds) ? item.facetOptionIds.map(String) : [],
            estimatedMinutes: int(0, 600)(minutes, `${label}.estimatedMinutes`),
            hidden: item.hidden === true
        }

        if (item.kind === 'demo' || item.kind === 'agent') {
            const field = item.kind === 'demo' ? 'storyId' : 'agentId'
            if (!OBJECT_ID_RE.test(String(item[field] || ''))) bad(`${label}.${field} is required`)
            out[field] = String(item[field])
        }
        if (item.kind === 'demo' && item.flowId) {

            if (!OBJECT_ID_RE.test(String(item.flowId))) bad(`${label}.flowId is invalid`)
            out.flowId = String(item.flowId)
            out.restrictToFlow = item.restrictToFlow !== false
        }
        if (item.kind === 'video') {
            out.url = text(item.url, 1000, `${label}.url`)
            if (!videoEmbed(out.url)) bad(`${label}.url must be a YouTube, Vimeo, Loom or Wistia link`)
        }
        if (item.kind === 'link') {
            out.url = text(item.url, 1000, `${label}.url`)
            if (!savedLinks.has(out.url)) {

                await assertPublicUrl(out.url, { httpsOnly: true }).catch(error => bad(`${label}.url: ${error.message}`))
            }
        }
        return out
    }))

    await assertInWorkspace(Models.Story, items, 'storyId', workspaceId, 'demo')
    await assertInWorkspace(Models.AiDemoAgent, items, 'agentId', workspaceId, 'agent')
    await assertFlows(Models, items, currentItems)
    return relinkItems(items, sections, facets)
}

export default async function normalizeShowcase(Models, showcase, authUser, body) {
    const input = asObject(body)
    const updates = {}

    if (input.name !== undefined) updates.name = text(input.name, 120, 'name') || 'Untitled showcase'
    if (input.layout !== undefined) updates.layout = oneOf(['gallery', 'playlist'])(input.layout, 'layout')

    Object.entries(GROUPS).forEach(([group, spec]) => {
        if (input[group] === undefined) return
        if (!input[group] || typeof input[group] !== 'object' || Array.isArray(input[group])) bad(`${group} must be an object`)
        Object.entries(spec).forEach(([key, check]) => {
            if (input[group][key] !== undefined) updates[`${group}.${key}`] = check(input[group][key], `${group}.${key}`)
        })
    })

    if (input.cta && input.cta.url !== undefined) {
        const url = text(input.cta.url, 1000, 'cta.url')
        if (url) {

            await assertPublicUrl(url, { httpsOnly: true }).catch(error => bad(`cta.url: ${error.message}`))
        }
        updates['cta.url'] = url
    }
    if (input.embed && input.embed.allowedDomains !== undefined) {
        updates['embed.allowedDomains'] = normalizeAllowedDomains(input.embed.allowedDomains)
    }
    if (updates['embed.showBranding'] === false && !canRemoveBranding(authUser)) {
        httpError(ResponseCodes['403_FORBIDDEN'], 'Upgrade your plan to remove LiveDemo branding')
    }

    if (input.sections !== undefined || input.facets !== undefined || input.items !== undefined) {
        const current = showcase.toObject ? showcase.toObject() : showcase
        const sections = input.sections !== undefined ? normalizeSections(input.sections) : current.sections || []
        const facets = input.facets !== undefined ? normalizeFacets(input.facets) : current.facets || []
        if (input.sections !== undefined) updates.sections = sections
        if (input.facets !== undefined) updates.facets = facets
        updates.items = input.items !== undefined
            ? await normalizeItems(Models, showcase.workspaceId, input.items, sections, facets, current.items || [])
            : relinkItems(current.items || [], sections, facets)
    }

    return updates
}
