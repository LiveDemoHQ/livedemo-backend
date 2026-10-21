import crypto from 'crypto'
import path from 'path'
import short from 'short-uuid'
import helpers from '../helpers/livedemoHelpers.js'
import ENV from '../envServer.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import isAnalyticsExcludedIp from '../helpers/isAnalyticsExcludedIp.js'
import ipRateLimit from '../helpers/agent/ipRateLimit.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import postCustomChecklistValidator from '../helpers/validators/stories/custom/postCustomChecklistValidator.js'
import { normalizeChecklist, visibleItems, applyProgressEvents, isToken } from '../helpers/checklist/checklist.js'

// StoryDemo checklist (see STORYDEMO_CHECKLIST_TECH_DESIGN.md).
// Editor (auth + workspace member):
// POST /workspaces/:workspaceId/stories/:storyId/custom/checklist              whole checklist -> custom.checklist
// POST /workspaces/:workspaceId/stories/:storyId/custom/checklist/uploadImage  multipart image (?kind=icon|logo) -> { imageUrl }
// Viewer (no auth; the progress token is the capability):
// POST /checklists/:hostStoryId/progress                 { token?, delivery, referrer, utm } -> { token, completedItemIds, state, firstOpenedAt }
// POST /checklists/:hostStoryId/progress/:token/events   { storyId, sessionId, events: [...] } (sendBeacon, text/plain)
const HEX24 = /^[a-f0-9]{24}$/i
const ICON_MAX_BYTES = 64 * 1024
const LOGO_MAX_BYTES = 1024 * 1024
const startLimit = ipRateLimit({ limit: 30, interval: 60 * 1000, message: 'Too many checklist visits' })
const eventsLimit = ipRateLimit({ limit: 120, interval: 60 * 1000, message: 'Too many checklist events' })

const wrap = fn => (req, res) => fn(req, res).catch(error => sendError(res, error))

async function auth(req) {
    const { Models } = req.mongo
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, req.params.workspaceId)
    return Models
}

const save = wrap(async (req, res) => {
    const Models = await auth(req)
    const body = helpers.validateBody(req.body, postCustomChecklistValidator).value
    const story = await Models.Story.findOne({ _id: req.params.storyId, workspaceId: req.params.workspaceId, deletedAt: null }).select('workspaceId custom.checklist').lean()
    if (!story) httpError(ResponseCodes['404_NOT_FOUND'], 'Story not found')

    const checklist = await normalizeChecklist(Models, story, body)
    const updated = await Models.Story.findOneAndUpdate(
        { _id: story._id, workspaceId: req.params.workspaceId },
        { $set: { 'custom.checklist': checklist } },
        { new: true }
    )
    sendJson(res, updated.custom.checklist)
})

const uploadImage = wrap(async (req, res) => {
    await auth(req)
    const file = req.file
    const maxBytes = req.query.kind === 'icon' ? ICON_MAX_BYTES : LOGO_MAX_BYTES
    if (!file || file.size > maxBytes || !['image/png', 'image/svg+xml'].includes(file.mimetype)) {

        httpError(ResponseCodes['400_BAD_REQUEST'], `PNG or SVG up to ${maxBytes / 1024} KB`)
    }
    const upload = await helpers.uploadBufferImage(file.buffer, file.mimetype, short.uuid() + path.extname(file.originalname))
    sendJson(res, { imageUrl: upload.Location })
})

function cleanUtm(raw) {
    const utm = {}
    Object.entries(raw && typeof raw === 'object' ? raw : {}).slice(0, 10).forEach(([key, value]) => {
        if (/^utm_[a-z]{1,20}$/.test(key) && typeof value === 'string') utm[key] = value.slice(0, 200)
    })
    return utm
}

function loadHost(Models, hostStoryId) {
    if (!HEX24.test(String(hostStoryId))) return null
    return Models.Story.findOne({ _id: hostStoryId, deletedAt: null, 'custom.checklist.isActive': true })
        .select('_id workspaceId isPublished custom.checklist').lean()
}

const progressView = progress => ({
    token: progress.token,
    completedItemIds: progress.completedItemIds.map(String),
    state: progress.state,
    firstOpenedAt: progress.firstOpenedAt
})

// Drafts and excluded IPs get { token: null }: the player keeps progress in memory / localStorage only
const start = wrap(async (req, res) => {
    await startLimit(req)
    const { Models } = req.mongo
    const host = await loadHost(Models, req.params.hostStoryId)
    if (!host) httpError(ResponseCodes['404_NOT_FOUND'], 'Checklist not found')
    if (!host.isPublished) return sendJson(res, { token: null })

    const body = req.body || {}
    const clientIp = String(req.headers['x-forwarded-for'] || (ENV.ENV === 'dev' ? '69.200.224.152' : '')).split(',')[0].trim()
    if (await isAnalyticsExcludedIp(clientIp, Models, host.workspaceId)) return sendJson(res, { token: null })

    const version = host.custom.checklist.version || 1
    const existing = isToken(body.token) ? await Models.ChecklistProgress.findOne({ token: body.token, hostStoryId: host._id }) : null
    if (existing) {

        if (existing.checklistVersion !== version) {

            existing.checklistVersion = version
            existing.completedItemIds = []
            existing.convertedItemIds = []
            existing.state = 'closed'
            existing.completedAt = null
        }
        existing.lastSeenTimestamp = Date.now()
        await existing.save()
        return sendJson(res, progressView(existing))
    }

    const ipData = clientIp ? await helpers.getClientIpData(clientIp).catch(() => null) : null
    const now = Date.now()
    const progress = await new Models.ChecklistProgress({
        token: crypto.randomBytes(16).toString('hex'),
        hostStoryId: host._id,
        workspaceId: host.workspaceId,
        checklistVersion: version,
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
    sendJson(res, progressView(progress))
})

// The batch's sessionId must be a Session of the played story, and that story must be the host or a task.
// Only then does item_complete count, and the Session is joined to this journey.
async function verifiedSession(Models, host, items, body) {
    const storyId = String(body.storyId || '')
    const inChecklist = storyId === String(host._id) || items.some(item => String(item.clickAction.storyId) === storyId)
    if (!inChecklist || !HEX24.test(storyId) || !HEX24.test(String(body.sessionId || ''))) return null

    const session = await Models.Session.findOne({ _id: body.sessionId, storyId, workspaceId: host.workspaceId }).select('_id storyId checklistProgressId').lean()
    return session
}

const postEvents = wrap(async (req, res) => {
    await eventsLimit(req)
    const { Models } = req.mongo
    const host = await loadHost(Models, req.params.hostStoryId)
    const progress = host && isToken(req.params.token)
        ? await Models.ChecklistProgress.findOne({ token: req.params.token, hostStoryId: host._id })
        : null
    if (!progress) return sendJson(res, { ok: false })

    let body = req.body
    if (typeof body === 'string') {

        try {
            body = JSON.parse(body)
        } catch {
            body = {}
        }
    }
    body = body && typeof body === 'object' ? body : {}

    const items = (await visibleItems(Models, host)).map(({ item }) => item)
    const session = await verifiedSession(Models, host, items, body)
    applyProgressEvents(progress, items, Array.isArray(body.events) ? body.events : [], {
        storyId: body.storyId,
        sessionStoryId: session ? String(session.storyId) : null,
        sessionId: session ? session._id : null
    })
    await progress.save()
    if (session && !session.checklistProgressId) {

        await Models.Session.updateOne({ _id: session._id }, { $set: { checklistProgressId: progress._id } })
    }
    sendJson(res, { completedItemIds: progress.completedItemIds.map(String), completedAt: progress.completedAt })
})

export default {
    save,
    uploadImage,
    start,
    postEvents
}
