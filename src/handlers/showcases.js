import helpers from '../helpers/livedemoHelpers.js'
import ENV from '../envServer.js'
import isAnalyticsExcludedIp from '../helpers/isAnalyticsExcludedIp.js'
import ipRateLimit from '../helpers/agent/ipRateLimit.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import normalizeShowcase, { videoEmbed } from '../helpers/showcase/normalizeShowcase.js'
import { loadShowcaseInWorkspace, loadPublicShowcase, resolveItems } from '../helpers/showcase/showcase.js'

// Showcases: multi-demo hubs (see SHOWCASES_PLAN.md).
// Editor (auth + workspace member inside every handler):
// POST   /workspaces/:workspaceId/showcases                       { name, layout }
// GET    /workspaces/:workspaceId/showcases                       list with item count + cover thumbnails
// GET    /workspaces/:workspaceId/showcases/:showcaseId           doc + resolvedItems (editor mode)
// PATCH  /workspaces/:workspaceId/showcases/:showcaseId           partial update via normalizeShowcase
// DELETE /workspaces/:workspaceId/showcases/:showcaseId           soft delete
// POST   /workspaces/:workspaceId/showcases/:showcaseId/publish   { isPublished }
// Visitor (loadPublicShowcase):
// POST   /showcases/:showcaseId/sessions                          { delivery, referrer, utm } -> { sessionId }
// POST   /showcases/:showcaseId/sessions/:sessionId/events        { events: [...] } (sendBeacon, text/plain)

const VIA = ['grid', 'playlist', 'autoplay', 'deeplink', 'search']
const MAX_PATH = 200
const MAX_FILTERS = 100
const sessionLimit = ipRateLimit({ limit: 30, interval: 60 * 1000, message: 'Too many showcase visits' })
const eventsLimit = ipRateLimit({ limit: 120, interval: 60 * 1000, message: 'Too many showcase events' })

const wrap = fn => (req, res) => fn(req, res).catch(error => sendError(res, error))

async function auth(req) {
    const { Models } = req.mongo
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, req.params.workspaceId)
    return { Models, authUser }
}

async function withResolvedItems(Models, showcase) {
    return { ...showcase.toObject(), resolvedItems: await resolveItems(Models, showcase, 'editor') }
}

const create = wrap(async (req, res) => {
    const { Models, authUser } = await auth(req)
    const body = req.body || {}
    const showcase = await new Models.Showcase({
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : 'Untitled showcase',
        layout: body.layout === 'playlist' ? 'playlist' : 'gallery',
        workspaceId: req.params.workspaceId,
        userId: authUser.id
    }).save()
    sendJson(res, { _id: showcase._id })
})

const list = wrap(async (req, res) => {
    const { Models } = await auth(req)
    const showcases = await Models.Showcase.find({
        workspaceId: req.params.workspaceId,
        deletedAt: null
    }).select('-sections -facets').sort({ updatedAt: -1 }).lean()

    // Cover collage: first 4 visible items with a picture
    const coverItems = showcases.flatMap(s => s.items.filter(item => !item.hidden).slice(0, 4))
    const storyIds = coverItems.map(item => item.storyId).filter(Boolean)
    const stories = storyIds.length
        ? await Models.Story.find({ _id: { $in: storyIds } }).select('thumbnailImageUrl').lean()
        : []
    const thumbOf = (item) => {
        const story = item.storyId && stories.find(s => String(s._id) === String(item.storyId))
        return item.thumbnailUrl || (story && story.thumbnailImageUrl) || (item.kind === 'video' && (videoEmbed(item.url) || {}).thumbnailUrl) || ''
    }

    sendJson(res, showcases.map(({ items, ...showcase }) => ({
        ...showcase,
        itemCount: items.length,
        covers: items.filter(item => !item.hidden).slice(0, 4).map(thumbOf).filter(Boolean)
    })))
})

const get = wrap(async (req, res) => {
    const { Models } = await auth(req)
    const showcase = await loadShowcaseInWorkspace(Models, req.params.workspaceId, req.params.showcaseId)
    sendJson(res, await withResolvedItems(Models, showcase))
})

const patch = wrap(async (req, res) => {
    const { Models, authUser } = await auth(req)
    const showcase = await loadShowcaseInWorkspace(Models, req.params.workspaceId, req.params.showcaseId)
    const updates = await normalizeShowcase(Models, showcase, authUser, req.body)
    const updated = await Models.Showcase.findOneAndUpdate({ _id: showcase._id }, { $set: updates }, { new: true })
    sendJson(res, await withResolvedItems(Models, updated))
})

const remove = wrap(async (req, res) => {
    const { Models } = await auth(req)
    const showcase = await loadShowcaseInWorkspace(Models, req.params.workspaceId, req.params.showcaseId)
    await Models.Showcase.updateOne({ _id: showcase._id }, { $set: { deletedAt: new Date() } })
    sendJson(res)
})

const publish = wrap(async (req, res) => {
    const { Models, authUser } = await auth(req)
    const isPublished = !!(req.body && req.body.isPublished)
    // A claimed template can land in a workspace without the plan; unpublishing stays allowed
    if (isPublished && !(authUser.featureFlags && authUser.featureFlags.allowShowcases)) {

        httpError(ResponseCodes['403_FORBIDDEN'], 'Upgrade your plan to publish Showcases')
    }
    const showcase = await loadShowcaseInWorkspace(Models, req.params.workspaceId, req.params.showcaseId)
    const updated = await Models.Showcase.findOneAndUpdate(
        { _id: showcase._id },
        { $set: { isPublished } },
        { new: true }
    )
    sendJson(res, await withResolvedItems(Models, updated))
})

function cleanUtm(raw) {
    const utm = {}
    Object.entries(raw && typeof raw === 'object' ? raw : {}).slice(0, 10).forEach(([key, value]) => {
        if (/^utm_[a-z]{1,20}$/.test(key) && typeof value === 'string') utm[key] = value.slice(0, 200)
    })
    return utm
}

// Same IP handling as postStorySession; excluded IPs get no session and the player records nothing
const createSession = wrap(async (req, res) => {
    await sessionLimit(req)
    const { Models } = req.mongo
    const showcase = await loadPublicShowcase(req, Models, req.params.showcaseId)
    // Drafts are only reachable by the team: keep them out of analytics
    if (!showcase.isPublished) return sendJson(res, { sessionId: null })

    const body = req.body || {}
    const clientIp = String(req.headers['x-forwarded-for'] || (ENV.ENV === 'dev' ? '69.200.224.152' : '')).split(',')[0].trim()
    if (await isAnalyticsExcludedIp(clientIp, Models, showcase.workspaceId)) return sendJson(res, { sessionId: null })

    const ipData = clientIp ? await helpers.getClientIpData(clientIp).catch(() => null) : null
    const now = Date.now()
    const session = await new Models.ShowcaseSession({
        showcaseId: showcase._id,
        workspaceId: showcase.workspaceId,
        delivery: body.delivery === 'embed' ? 'embed' : 'link',
        referrer: typeof body.referrer === 'string' ? body.referrer.slice(0, 500) : '',
        utm: cleanUtm(body.utm),
        clientIpData: ipData ? {
            ip: ipData.ip,
            country: ipData.country,
            country_code: ipData.country_code,
            region: ipData.region,
            city: ipData.city,
            timezone: ipData.timezone
        } : {},
        startTimestamp: now,
        lastSeenTimestamp: now
    }).save()
    sendJson(res, { sessionId: session._id })
})

// Untrusted journey events: ids checked against the showcase, counters bounded, arrays capped
const postEvents = wrap(async (req, res) => {
    await eventsLimit(req)
    const { Models } = req.mongo
    const showcase = await loadPublicShowcase(req, Models, req.params.showcaseId)
    const session = /^[a-f0-9]{24}$/i.test(String(req.params.sessionId))
        ? await Models.ShowcaseSession.findOne({ _id: req.params.sessionId, showcaseId: showcase._id })
        : null
    if (!session) return sendJson(res, { ok: false })

    let body = req.body
    if (typeof body === 'string') {

        try {
            body = JSON.parse(body)
        } catch {
            body = {}
        }
    }
    const events = (body && Array.isArray(body.events) ? body.events : []).slice(0, 50)
    const items = new Map(showcase.items.map(item => [String(item._id), item]))
    const facets = showcase.facets || []
    const now = Date.now()
    const at = value => (Number.isFinite(value) && value >= session.startTimestamp && value <= now + 60000 ? value : now)

    events.forEach((event) => {
        const e = event && typeof event === 'object' ? event : {}
        const item = items.get(String(e.itemId))
        if (e.t === 'open' && item) {

            session.path.push({
                itemId: item._id,
                kind: item.kind,
                storyId: item.storyId || null,
                via: VIA.includes(e.via) ? e.via : 'grid',
                openedAt: at(e.at)
            })
            session.itemsOpened += 1
        } else if (e.t === 'complete' && item) {

            const entry = [...session.path].reverse().find(p => p.itemId === item._id)
            if (entry && !entry.completedAt) {

                entry.completedAt = at(e.at)
                session.itemsCompleted += 1
            }
        } else if (e.t === 'filter') {

            const facet = facets.find(f => f._id === e.facetId)
            if (facet && facet.options.some(o => o._id === e.optionId) && session.filtersUsed.length < MAX_FILTERS) {

                session.filtersUsed.push({ facetId: e.facetId, optionId: e.optionId, at: at(e.at) })
            }
        }
    })

    if (session.path.length > MAX_PATH) session.path.splice(0, session.path.length - MAX_PATH)
    const done = new Set(session.path.filter(p => p.completedAt).map(p => p.itemId))
    const visible = showcase.items.filter(item => !item.hidden)
    session.didComplete = showcase.layout === 'playlist' && visible.length > 0 && visible.every(item => done.has(item._id))
    session.lastSeenTimestamp = now
    await session.save()
    sendJson(res, { ok: true })
})

export default {
    create,
    list,
    get,
    patch,
    remove,
    publish,
    createSession,
    postEvents
}
