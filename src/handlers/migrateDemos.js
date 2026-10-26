import ENV from '../envServer.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import helpers from '../helpers/livedemoHelpers.js'
import ipRateLimit from '../helpers/agent/ipRateLimit.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import internalRoute from '../helpers/internalAuth.js'
import findPreviewStory from '../helpers/findPreviewStory.js'
import { isObjectIdString, firstWorkspaceId } from '../helpers/own/own.js'
import { ownablePreviewCount } from '../helpers/own/cloneForClaim.js'
import { importStoryDemo, importPayloadIssue } from '../helpers/importStoryDemo.js'
import postStoryImportValidator from '../helpers/validators/stories/postStoryImportValidator.js'
import postMigrateDemosValidator from '../helpers/validators/migrateDemos/postMigrateDemosValidator.js'
import {
    migrateDemoProvider,
    enqueueProcessMigrateDemo,
    upsertMigrateDemo,
    countRecentRequests,
    countRecentRequestsByUser,
    claimMigrateDemoRequests,
    sendMigrateDemoEmails
} from '../helpers/migrateDemos.js'
import { syncMigrateLead } from '../helpers/sequenzy/sequenzyClient.js'

import logger from '../helpers/logger.js'

// Clone a public Storylane / Arcade / Navattic / Supademo demo (livedemo-ai-api/clone_demos_tech_design.md).
// Public (landing page):
// POST /migratedemos                                  { email, url, browserSessionId? } -> { _id, status }
// Authenticated (web-app onboarding; Bearer token, no email):
// POST /migratedemos                                  { url, browserSessionId? } -> { _id, status, ownClaimId? }
// GET  /migratedemos/:migrateDemoId                   status, editor links, storyDoc once completed; never requests
// Internal (livedemo-ai-api, Authorization: Internal <INTERNAL_API_KEY>):
// POST /internal/workspaces/:workspaceId/stories/import   import payload + { userId, ownable }
// POST /internal/migratedemos/:migrateDemoId/emails       -> { sent, failed }
// POST /internal/migratedemos/:migrateDemoId/claims       -> { claimed }

const ipLimit = ipRateLimit({ limit: 3, interval: 60 * 1000, message: 'Too many requests, try again in a minute' })
const MAX_REQUESTS_PER_EMAIL_PER_DAY = 5
const PUBLIC_FIELDS = '_id status error provider storyId storyUrl taskStoryUrls'

const wrap = fn => (req, res) => fn(req, res).catch(error => sendError(res, error))
const bad = message => httpError(ResponseCodes['400_BAD_REQUEST'], message)

function providerOf(url) {

    try {

        return migrateDemoProvider(url)
    } catch {

        return undefined
    }
}

async function tryGetAuthUser(req, Models) {

    if (!req.get('Authorization')) {

        return null
    }
    try {

        const { authUser } = await helpers.authReq(req, Models)
        return authUser || null
    } catch {

        return null
    }
}

const postMigrateDemo = wrap(async (req, res) => {

    const { Models } = req.mongo
    if (!ENV.MIGRATE_WORKSPACE_ID) {

        httpError(ResponseCodes['503_SERVICE_UNAVAILABLE'], 'Demo cloning is not available right now')
    }
    await ipLimit(req)
    const authHeader = req.get('Authorization')
    const authUser = await tryGetAuthUser(req, Models)
    if (authHeader && !authUser) {

        httpError(ResponseCodes['401_UNAUTHORIZED'], 'Sign in again')
    }
    const { error, value } = postMigrateDemosValidator(req.body || {})
    if (error) {

        bad(/email/.test(error.message) ? 'Enter a valid email address' : 'Enter a valid https:// demo link')
    }
    const { email, url, browserSessionId } = value
    if (!authUser && !email) {

        bad('Enter a valid email address')
    }
    if (!providerOf(url)) {

        bad('Paste a public Storylane, Arcade, Navattic or Supademo demo link')
    }

    const workspaceId = authUser ? firstWorkspaceId(authUser) : null
    if (authUser && !workspaceId) {

        bad('Create a workspace first')
    }
    if (authUser) {

        if (await countRecentRequestsByUser(Models, authUser._id) >= MAX_REQUESTS_PER_EMAIL_PER_DAY) {

            httpError(ResponseCodes['429_TOO_MANY_REQUESTS'], 'Too many requests today, try again tomorrow')
        }
    } else if (await countRecentRequests(Models, email) >= MAX_REQUESTS_PER_EMAIL_PER_DAY) {

        httpError(ResponseCodes['429_TOO_MANY_REQUESTS'], 'Too many requests for this email today, try again tomorrow')
    }

    const request = authUser
        ? {
            email: email || undefined,
            source: 'app',
            userId: authUser._id,
            browserSessionId: browserSessionId || undefined,
            // Stamp now so the clone job's claims route copies into this workspace when done
            claimUserId: authUser._id,
            claimWorkspaceId: workspaceId
        }
        : {
            email,
            source: 'landing',
            browserSessionId: browserSessionId || undefined
        }

    const doc = await upsertMigrateDemo(Models, { url, request })
    // the job is idempotent: a completed link just emails this requester (landing) / claims (app)
    await enqueueProcessMigrateDemo(doc._id).catch((err) => {

        logger.error('[migrateDemos] enqueue failed', { eventName: 'ENQUEUE_FAILED', err: err })
        if (doc.status !== 'completed') {

            throw err
        }
    })

    let ownClaimId = null
    if (authUser) {

        await claimMigrateDemoRequests(Models, doc._id)
        const fresh = await Models.MigrateDemo.findById(doc._id).select('requests').lean()
        const mine = [...((fresh && fresh.requests) || [])].reverse().find((r) => (
            String(r.claimUserId) === String(authUser._id) && r.ownClaimId
        ))
        ownClaimId = mine ? mine.ownClaimId : null
    }

    sendJson(res, { _id: doc._id, status: doc.status, ownClaimId })
    if (email || (authUser && authUser.email)) {

        syncMigrateLead(email || authUser.email, Models, { provider: providerOf(url) })
    }
})

// No browserSessionId filter: the email link is opened on other devices, and the content is a copy of a public demo
const getMigrateDemo = wrap(async (req, res) => {

    const { Models } = req.mongo
    const { migrateDemoId } = req.params
    const doc = isObjectIdString(migrateDemoId)
        ? await Models.MigrateDemo.findById(migrateDemoId).select(PUBLIC_FIELDS).lean()
        : null
    if (!doc) {

        httpError(ResponseCodes['404_NOT_FOUND'], 'Not found')
    }
    if (doc.status === 'completed' && doc.storyId) {

        doc.storyDoc = await findPreviewStory(Models, doc.storyId)
    }
    sendJson(res, doc)
})

// Same import as POST /workspaces/:workspaceId/stories/import, for a job that has no user token.
// ownable: the host story of a clone becomes a "Make it yours" source whose claim tokens never expire
const postInternalStoryImport = internalRoute(async (req, res) => {

    const { Models } = req.mongo
    const { workspaceId } = req.params
    const { userId, ownable, ...payload } = req.body || {}
    if (!isObjectIdString(workspaceId) || !isObjectIdString(userId)) {

        bad('workspaceId and userId must be ids')
    }
    const body = helpers.validateBody(payload, postStoryImportValidator).value
    const issue = importPayloadIssue(body)
    if (issue) {

        bad(issue)
    }

    const storyId = await importStoryDemo(Models, body, { workspaceId, userId })
    let claimable = false
    if (ownable === true) {

        const count = await ownablePreviewCount(Models, 'story', await Models.Story.findById(storyId).lean())
        claimable = !count.tooLarge
        if (claimable) {

            await Models.Story.updateOne({ _id: storyId }, {
                $set: {
                    isPublished: true,
                    ownable: {
                        enabled: true,
                        enabledBy: userId,
                        enabledAt: new Date(),
                        claimTokenTtlHours: 0
                    }
                }
            })
        }
    }
    const story = await Models.Story.findById(storyId)
        .populate({ path: 'screens', select: '_id type imageUrl' })
        .lean()
    res.json({ ...story, claimable })
})

async function loadMigrateDemo(Models, migrateDemoId) {

    const doc = isObjectIdString(migrateDemoId) ? await Models.MigrateDemo.findById(migrateDemoId).lean() : null
    if (!doc) {

        httpError(ResponseCodes['404_NOT_FOUND'], 'Not found')
    }
    if (doc.status !== 'completed') {

        httpError(ResponseCodes['409_CONFLICT'], 'Not completed')
    }
    return doc
}

const postInternalEmails = internalRoute(async (req, res) => {

    const { Models } = req.mongo
    const doc = await loadMigrateDemo(Models, req.params.migrateDemoId)
    res.json(await sendMigrateDemoEmails(Models, doc))
})

const postInternalClaims = internalRoute(async (req, res) => {

    const { Models } = req.mongo
    const doc = await loadMigrateDemo(Models, req.params.migrateDemoId)
    res.json({ claimed: await claimMigrateDemoRequests(Models, doc._id) })
})

export default {
    postMigrateDemo,
    getMigrateDemo,
    postInternalStoryImport,
    postInternalEmails,
    postInternalClaims
}
