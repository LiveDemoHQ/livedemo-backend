import LambdaRateLimiter from 'lambda-rate-limiter'
import moment from 'moment'
import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import ipRateLimit from '../helpers/agent/ipRateLimit.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import {
    OWN_KINDS,
    isObjectIdString,
    cleanSessionId,
    loadOwnableSource,
    CLAIM_TOKEN_TTL_HOURS,
    createClaimToken,
    verifyClaimToken,
    findExistingClaim,
    enqueueOwnClaim,
    claimOwnRequestsForUser
} from '../helpers/own/own.js'
import { ownablePreviewCount } from '../helpers/own/cloneForClaim.js'

// "Make it yours" (OWNABLE_DEMOS_TECH_DESIGN.md §4).
// Author (auth + workspace member):
// PUT  /workspaces/:workspaceId/{stories|agents|showcases}/:id/ownable                 { enabled, ctaLabel?, includeKnowledge?, claimTokenTtlHours? }
// GET  /workspaces/:workspaceId/{stories|agents|showcases}/:id/ownable/preview-count   { stories, fromChecklist, sandboxFlows, agents, tooLarge, ownable, isPublished }
// GET  /workspaces/:workspaceId/own-claims/analytics?viewType=                         Templates analytics tab
// Visitor (public, preview pages only):
// GET  /own-claims/eligibility?kind=&id=          { eligible, ctaLabel, claimToken }
// POST /own-claims                                { sourceKind, sourceId, claimToken, browserSessionId?, workspaceId? }
// GET  /own-claims/:claimId?browserSessionId=     long-poll until completed / failed

const ipLimit = ipRateLimit({ limit: 5, interval: 60 * 1000, message: 'Too many copy requests' })
// Every eligibility call stores a claim token
const eligibilityIpLimit = ipRateLimit({ limit: 60, interval: 60 * 1000, message: 'Too many requests' })
const userLimiter = LambdaRateLimiter({ interval: 60 * 60 * 1000, uniqueTokenPerInterval: 5000 })
const POLL_INTERVAL_MS = 1000
const POLL_TIMEOUT_MS = 20000
const MAX_CTA_LABEL = 40
const VIEW_DAYS = { '48H': 2, '7D': 7, '30D': 30 }

const wrap = fn => (req, res) => fn(req, res).catch(error => sendError(res, error))
const bad = message => httpError(ResponseCodes['400_BAD_REQUEST'], message)
const sameId = (a, b) => !!a && !!b && String(a) === String(b)

async function tryGetAuthUser(req, Models) {
    if (!req.get('Authorization')) return null
    try {
        const { authUser } = await helpers.authReq(req, Models)
        return authUser || null
    } catch {
        return null
    }
}

async function authMember(req) {
    const { Models } = req.mongo
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, req.params.workspaceId)
    return { Models, authUser }
}

async function loadInWorkspace(Models, kind, id, workspaceId) {
    const doc = isObjectIdString(id)
        ? await Models[OWN_KINDS[kind].model].findOne({ _id: id, workspaceId, deletedAt: null }).lean()
        : null
    if (!doc) httpError(ResponseCodes['404_NOT_FOUND'], 'Not found')
    return doc
}

const putOwnable = kind => wrap(async (req, res) => {
    const { Models, authUser } = await authMember(req)
    const body = req.body || {}
    if (typeof body.enabled !== 'boolean') bad('enabled must be true or false')
    if (body.ctaLabel !== undefined && (typeof body.ctaLabel !== 'string' || body.ctaLabel.trim().length > MAX_CTA_LABEL)) bad(`ctaLabel must be text up to ${MAX_CTA_LABEL} characters`)
    if (body.includeKnowledge !== undefined && typeof body.includeKnowledge !== 'boolean') bad('includeKnowledge must be true or false')
    if (body.claimTokenTtlHours !== undefined && !CLAIM_TOKEN_TTL_HOURS.includes(body.claimTokenTtlHours)) bad(`claimTokenTtlHours must be one of ${CLAIM_TOKEN_TTL_HOURS.join(', ')}`)
    // Turning it off is always allowed, so an unflagged teammate can still stop a template
    if (body.enabled && !(authUser.featureFlags && authUser.featureFlags.allowOwnableContent === true)) {

        httpError(ResponseCodes['403_FORBIDDEN'], 'Not allowed')
    }

    const doc = await loadInWorkspace(Models, kind, req.params.id, req.params.workspaceId)
    if (body.enabled && !(doc.ownable && doc.ownable.enabled)) {

        const count = await ownablePreviewCount(Models, kind, doc)
        if (count.tooLarge) bad(`Claimable copies can include up to ${count.max} demos`)
    }

    const set = { 'ownable.enabled': body.enabled }
    if (body.ctaLabel !== undefined) set['ownable.ctaLabel'] = body.ctaLabel.trim()
    if (body.includeKnowledge !== undefined && kind === 'agent') set['ownable.includeKnowledge'] = body.includeKnowledge
    if (body.claimTokenTtlHours !== undefined) set['ownable.claimTokenTtlHours'] = body.claimTokenTtlHours
    if (body.enabled) {

        set['ownable.enabledBy'] = authUser._id
        set['ownable.enabledAt'] = new Date()
    }
    // Plain update: stays out of agent undo/redo and story revisions
    const updated = await Models[OWN_KINDS[kind].model].findOneAndUpdate({ _id: doc._id }, { $set: set }, { new: true })
        .select('ownable')
        .lean()
    sendJson(res, updated.ownable)
})

const getPreviewCount = kind => wrap(async (req, res) => {
    const { Models } = await authMember(req)
    const doc = await loadInWorkspace(Models, kind, req.params.id, req.params.workspaceId)
    const count = await ownablePreviewCount(Models, kind, doc)
    // Settings panel reads its state here so it never trusts a stale editor copy
    sendJson(res, {
        ...count,
        ownable: doc.ownable || null,
        isPublished: doc.isPublished === true
    })
})

const getEligibility = wrap(async (req, res) => {
    const { Models } = req.mongo
    const { kind, id } = req.query
    await eligibilityIpLimit(req)
    const source = await loadOwnableSource(Models, kind, id)
    if (!source) return sendJson(res, { eligible: false })
    const claimToken = await createClaimToken(Models, source)

    sendJson(res, {
        eligible: true,
        ctaLabel: source.ctaLabel,
        name: source.name,
        // Lets the web-app hide the button from the author's own workspace members
        workspaceId: source.workspaceId,
        claimToken
    })
})

// Logged in: the body workspace if the user is a member, else their first one
function targetWorkspaceId(authUser, requested) {
    if (requested) {

        helpers.validateUserHasAccessToWorkspace(authUser, String(requested))
        return String(requested)
    }
    const first = authUser.workspaces && authUser.workspaces[0]
    return first ? String(first._id || first) : null
}

const postClaim = wrap(async (req, res) => {
    const { Models } = req.mongo
    await ipLimit(req)
    const body = req.body || {}
    const kind = body.sourceKind
    const sourceId = String(body.sourceId || '')
    // The only way to create a claim: a token handed out by a preview page's eligibility call
    if (!(await verifyClaimToken(Models, body.claimToken, kind, sourceId))) httpError(ResponseCodes['403_FORBIDDEN'], 'Claim link expired, reload the page')

    const source = await loadOwnableSource(Models, kind, sourceId)
    if (!source) httpError(ResponseCodes['404_NOT_FOUND'], 'This is no longer claimable')

    const authUser = await tryGetAuthUser(req, Models)
    const browserSessionId = cleanSessionId(body.browserSessionId)

    if (!authUser) {

        if (!browserSessionId) bad('browserSessionId is required')
        const claim = await Models.OwnClaim.findOneAndUpdate(
            {
                browserSessionId,
                sourceKind: kind,
                sourceId: source._id,
                userId: null,
                status: 'pending'
            },
            { $setOnInsert: { sourceWorkspaceId: source.workspaceId } },
            { upsert: true, new: true }
        ).lean()
        return sendJson(res, {
            _id: claim._id,
            status: 'pending',
            requiresAuth: true
        })
    }

    await userLimiter.check(20, String(authUser._id)).catch(() => httpError(ResponseCodes['429_TOO_MANY_REQUESTS'], 'Too many copy requests'))
    const workspaceId = targetWorkspaceId(authUser, body.workspaceId)
    if (!workspaceId) bad('No workspace to copy into')

    const existing = await findExistingClaim(Models, {
        userId: authUser._id,
        workspaceId,
        kind,
        sourceId: source._id
    }, true)
    if (existing) return sendJson(res, { _id: existing._id, status: existing.status })

    const claim = await new Models.OwnClaim({
        sourceKind: kind,
        sourceId: source._id,
        sourceWorkspaceId: source.workspaceId,
        browserSessionId: browserSessionId || '',
        userId: authUser._id,
        workspaceId,
        status: 'cloning'
    }).save()
    await enqueueOwnClaim(claim._id)
    sendJson(res, { _id: claim._id, status: claim.status })
})

async function claimView(Models, claim) {
    const view = {
        _id: claim._id,
        sourceKind: claim.sourceKind,
        sourceId: claim.sourceId,
        status: claim.status,
        error: claim.error
    }
    const source = await Models[OWN_KINDS[claim.sourceKind].model].findById(claim.sourceId).select('name').lean()
    view.sourceName = (source && source.name) || ''
    if (claim.status === 'completed') {

        view.clonedId = claim.clonedId
        view.workspaceId = claim.workspaceId
        view.editorPath = OWN_KINDS[claim.sourceKind].editorPath(claim.workspaceId, claim.clonedId)
    }
    return view
}

const getClaim = wrap(async (req, res) => {
    const { Models } = req.mongo
    const { claimId } = req.params
    if (!isObjectIdString(claimId)) httpError(ResponseCodes['404_NOT_FOUND'], 'Not found')
    const browserSessionId = cleanSessionId(req.query.browserSessionId)
    const authUser = await tryGetAuthUser(req, Models)

    // Signed in through a path that didn't carry the session id (another tab, landing One Tap without a
    // browsed demo...): the claim page itself finishes the claim, same rules as the auth hook
    if (authUser && browserSessionId) {

        const pending = await Models.OwnClaim.exists({
            _id: claimId,
            browserSessionId,
            userId: null,
            status: 'pending'
        })
        if (pending) await claimOwnRequestsForUser(browserSessionId, authUser, Models)
    }

    const startedAt = Date.now()
    for (;;) {
        const claim = await Models.OwnClaim.findById(claimId).lean()
        const allowed = claim && ((browserSessionId && claim.browserSessionId === browserSessionId) || (authUser && sameId(claim.userId, authUser._id)))
        if (!allowed) httpError(ResponseCodes['404_NOT_FOUND'], 'Not found')

        const settled = ['completed', 'failed', 'pending'].includes(claim.status)
        if (settled || Date.now() - startedAt >= POLL_TIMEOUT_MS) return sendJson(res, await claimView(Models, claim))
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    }
})

const emailDomain = email => (String(email || '').split('@')[1] || '').toLowerCase()

// Templates tab of the Analytics page. Claims are on the author's side (sourceWorkspaceId); claimers are shown
// by email domain only. ponytail: grouped in Node over the window's claims; fine for thousands, upgrade to $group
const getAnalytics = wrap(async (req, res) => {
    const { Models, authUser } = await authMember(req)
    if (!(authUser.featureFlags && authUser.featureFlags.allowOwnableContent === true)) httpError(ResponseCodes['403_FORBIDDEN'], 'Not allowed')

    const viewType = VIEW_DAYS[req.query.viewType] ? req.query.viewType : '30D'
    const since = moment().subtract(VIEW_DAYS[viewType], 'day').toDate()
    const claims = await Models.OwnClaim.find({ sourceWorkspaceId: req.params.workspaceId, createdAt: { $gte: since } })
        .sort({ createdAt: -1 })
        .lean()

    const users = await Models.User.find({ _id: { $in: [...new Set(claims.map(c => c.userId).filter(Boolean).map(String))] } })
        .select('email createdAt')
        .lean()
    const userById = new Map(users.map(u => [String(u._id), u]))
    // Signed up after clicking = a new account the template brought in
    const isNewUser = (claim) => {
        const user = claim.userId && userById.get(String(claim.userId))
        return !!user && new Date(user.createdAt).getTime() >= new Date(claim.createdAt).getTime() - 60 * 1000
    }

    const sources = new Map()
    for (const kind of Object.keys(OWN_KINDS)) {
        const ids = [...new Set(claims.filter(c => c.sourceKind === kind).map(c => String(c.sourceId)))]
        const enabled = await Models[OWN_KINDS[kind].model].find({ workspaceId: req.params.workspaceId, 'ownable.enabled': true, deletedAt: null }).select('_id').lean()
        const docs = await Models[OWN_KINDS[kind].model].find({ _id: { $in: [...ids, ...enabled.map(d => String(d._id))] } })
            .select('name isPublished ownable deletedAt')
            .lean()
        docs.forEach(doc => sources.set(String(doc._id), {
            kind,
            sourceId: doc._id,
            name: doc.name || 'Untitled',
            isPublished: !!doc.isPublished,
            enabled: !!(doc.ownable && doc.ownable.enabled) && !doc.deletedAt,
            clicks: 0,
            completed: 0,
            pending: 0,
            failed: 0,
            newUsers: 0,
            lastClaimAt: null
        }))
    }

    const durations = []
    const series = new Map()
    const bucketFormat = viewType === '48H' ? 'YYYY-MM-DD HH:00' : 'YYYY-MM-DD'
    const bucketUnit = viewType === '48H' ? 'hour' : 'day'
    // Empty buckets too, so the chart's x axis is continuous
    for (let t = moment(since).startOf(bucketUnit); t.isSameOrBefore(moment()); t.add(1, bucketUnit)) {

        const key = t.format(bucketFormat)
        series.set(key, { date: key, clicks: 0, completed: 0 })
    }
    for (const claim of claims) {
        const row = sources.get(String(claim.sourceId))
        const bucketKey = moment(claim.createdAt).format(bucketFormat)
        const bucket = series.get(bucketKey) || { date: bucketKey, clicks: 0, completed: 0 }
        bucket.clicks += 1
        if (claim.status === 'completed') bucket.completed += 1
        series.set(bucketKey, bucket)
        if (claim.completedAt) durations.push(new Date(claim.completedAt) - new Date(claim.createdAt))
        if (!row) continue

        row.clicks += 1
        if (claim.status === 'completed') row.completed += 1
        if (claim.status === 'pending') row.pending += 1
        if (claim.status === 'failed') row.failed += 1
        if (isNewUser(claim)) row.newUsers += 1
        if (!row.lastClaimAt) row.lastClaimAt = claim.createdAt
    }

    const rows = [...sources.values()]
    const sum = key => rows.reduce((total, row) => total + row[key], 0)
    const clicks = claims.length
    const completed = claims.filter(c => c.status === 'completed').length

    sendJson(res, {
        viewType,
        totals: {
            clicks,
            completed,
            pending: claims.filter(c => c.status === 'pending').length,
            failed: claims.filter(c => c.status === 'failed').length,
            newUsers: sum('newUsers'),
            conversionRate: clicks ? Math.round(completed / clicks * 1000) / 10 : 0,
            medianSecondsToCopy: durations.length ? Math.round(durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)] / 1000) : null,
            activeTemplates: rows.filter(row => row.enabled && row.isPublished).length
        },
        series: [...series.values()].sort((a, b) => a.date.localeCompare(b.date)),
        sources: rows.sort((a, b) => b.clicks - a.clicks),
        recent: claims.slice(0, 50).map(claim => ({
            _id: claim._id,
            kind: claim.sourceKind,
            sourceId: claim.sourceId,
            sourceName: (sources.get(String(claim.sourceId)) || {}).name || 'Deleted',
            status: claim.status,
            error: claim.error,
            createdAt: claim.createdAt,
            completedAt: claim.completedAt,
            claimerDomain: claim.userId ? emailDomain((userById.get(String(claim.userId)) || {}).email) : '',
            isNewUser: isNewUser(claim)
        }))
    })
})

export default {
    putOwnable,
    getPreviewCount,
    getEligibility,
    postClaim,
    getClaim,
    getAnalytics
}
