import mongoose from 'mongoose'
import ENV from '../envServer.js'
import enqueueJob from './enqueueJob.js'
import normalizeDemoUrl from './normalizeDemoUrl.js'
import { sendEmail } from './emails/emailsSender.js'
import Templates from './emails/templates/index.js'
import { cleanSessionId, firstWorkspaceId, loadOwnableSource, findExistingClaim, enqueueOwnClaim } from './own/own.js'

// Cloned Storylane / Arcade / Navattic / Supademo demos (livedemo-ai-api/clone_demos_tech_design.md).
// livedemo-ai-api's processMigrateDemo job does the clone; this side stores requests, claims copies and sends the emails

const { ObjectId } = mongoose.Types

// Fails fast on the landing form; livedemo-ai-api's providerFor(url) is the final check
const MIGRATE_DEMO_HOSTS = {
    'storylane.io': 'storylane',
    'arcade.software': 'arcade',
    'navattic.com': 'navattic',
    'supademo.com': 'supademo'
}

// storylane | arcade | navattic | supademo, or undefined
export function migrateDemoProvider(url) {

    const host = new URL(url).hostname.toLowerCase()
    const domain = Object.keys(MIGRATE_DEMO_HOSTS).find((d) => host === d || host.endsWith(`.${d}`))
    return MIGRATE_DEMO_HOSTS[domain]
}

export function enqueueProcessMigrateDemo(migrateDemoId) {

    return enqueueJob('migrateDemos', 'processMigrateDemo', { migrateDemoId: String(migrateDemoId) })
}

// One MigrateDemo per link: pushes the request (creating the doc if new) and re-queues a failed link.
// Same as livedemo-ai-api/clone/upsertMigrateDemo.js without force
export async function upsertMigrateDemo(Models, { url, request }) {

    const urlKey = normalizeDemoUrl(url)
    const upsert = () => Models.MigrateDemo.findOneAndUpdate(
        { urlKey },
        {
            $setOnInsert: {
                url,
                urlKey,
                provider: migrateDemoProvider(url),
                status: 'queued',
                workspaceId: ENV.MIGRATE_WORKSPACE_ID
            },
            $push: { requests: request }
        },
        { upsert: true, new: true }
    ).lean()
    // two concurrent first requests for a link: the unique urlKey index rejects one insert, its retry updates
    const doc = await upsert().catch((err) => {

        if (err.code === 11000) {

            return upsert()
        }
        throw err
    })
    if (doc.status !== 'failed') {

        return doc
    }
    const requeued = await Models.MigrateDemo.findOneAndUpdate(
        { _id: doc._id, status: 'failed' },
        { $set: { status: 'queued', error: null } },
        { new: true }
    ).lean()
    return requeued || Models.MigrateDemo.findById(doc._id).lean()
}

// Requests (all MigrateDemos) made with this email in the last 24h
export async function countRecentRequests(Models, email, now = Date.now()) {

    const since = new Date(now - 24 * 60 * 60 * 1000)
    const [row] = await Models.MigrateDemo.aggregate([
        { $match: { 'requests.email': email } },
        { $unwind: '$requests' },
        { $match: { 'requests.email': email, 'requests.createdAt': { $gte: since } } },
        { $count: 'n' }
    ])
    return row ? row.n : 0
}

// Copies the cloned story into the requester's workspace through "Make it yours" (OwnClaim + processOwnClaim).
// The request is taken atomically, so it's enqueued at most once. -> the OwnClaim id, or null
export async function claimMigrateDemoRequest(Models, migrateDemo, request, enqueue = enqueueOwnClaim) {

    if (migrateDemo.status !== 'completed' || !migrateDemo.storyId || !request.claimUserId || request.ownClaimId) {

        return null
    }
    // not claimable: too large, or the clone user lost allowOwnableContent
    const source = await loadOwnableSource(Models, 'story', String(migrateDemo.storyId))
    if (!source) {

        return null
    }
    const claimId = new ObjectId()
    const taken = await Models.MigrateDemo.updateOne(
        { _id: migrateDemo._id, requests: { $elemMatch: { _id: request._id, ownClaimId: null } } },
        { $set: { 'requests.$.ownClaimId': claimId } }
    )
    if (!taken.modifiedCount) {

        return null
    }
    // a "Make it yours" click from the same session (handled first on login) or an earlier copy
    const existing = await findExistingClaim(Models, {
        userId: request.claimUserId,
        workspaceId: request.claimWorkspaceId,
        kind: 'story',
        sourceId: source._id
    }, true)
    if (existing) {

        await Models.MigrateDemo.updateOne(
            { _id: migrateDemo._id, 'requests._id': request._id },
            { $set: { 'requests.$.ownClaimId': existing._id } }
        )
        return existing._id
    }
    await Models.OwnClaim.create({
        _id: claimId,
        sourceKind: 'story',
        sourceId: source._id,
        sourceWorkspaceId: source.workspaceId,
        browserSessionId: request.browserSessionId || '',
        userId: request.claimUserId,
        workspaceId: request.claimWorkspaceId,
        status: 'cloning'
    })
    await enqueue(claimId)
    return claimId
}

// Every request of this link whose session registered and that has no copy yet. -> number of claims made
export async function claimMigrateDemoRequests(Models, migrateDemoId, enqueue = enqueueOwnClaim) {

    const doc = await Models.MigrateDemo.findById(migrateDemoId).lean()
    let claimed = 0
    for (const request of (doc ? doc.requests : []).filter((r) => r.claimUserId && !r.ownClaimId)) {

        if (await claimMigrateDemoRequest(Models, doc, request, enqueue)) {

            claimed++
        }
    }
    return claimed
}

// On signup / login: stamps this session's requests with the user. Completed links are copied now; links still
// cloning are copied by the job (POST /internal/migratedemos/:id/claims) when they finish
export async function claimMigrateDemosForUser(browserSessionId, userDoc, Models, enqueue = enqueueOwnClaim) {

    const sessionId = cleanSessionId(browserSessionId)
    const workspaceId = userDoc && firstWorkspaceId(userDoc)
    if (!sessionId || !workspaceId) {

        return
    }
    const docs = await Models.MigrateDemo.find({ requests: { $elemMatch: { browserSessionId: sessionId, claimUserId: null } } }).lean()
    for (const doc of docs) {

        for (const request of doc.requests.filter((r) => r.browserSessionId === sessionId && !r.claimUserId)) {

            await Models.MigrateDemo.updateOne(
                { _id: doc._id, requests: { $elemMatch: { _id: request._id, claimUserId: null } } },
                { $set: { 'requests.$.claimUserId': userDoc._id, 'requests.$.claimWorkspaceId': workspaceId } }
            )
        }
        await claimMigrateDemoRequests(Models, doc._id, enqueue)
    }
}

function sendReadyEmail(email, demoUrl, Models) {

    return sendEmail(Templates.migrateDemoReady, { demoUrl }, [email], Models)
}

// "Your LiveDemo is ready" to every request not emailed yet. Each request is taken before sending, so a retried job
// or two overlapping calls never send twice; a failed send is released for the next call. -> { sent, failed }
export async function sendMigrateDemoEmails(Models, migrateDemo, send = sendReadyEmail) {

    const demoUrl = `${ENV.SERVER_URL}/migrate-demo?migrateDemoId=${migrateDemo._id}`
    let sent = 0
    let failed = 0
    for (const request of migrateDemo.requests.filter((r) => r.email && !r.emailSentAt)) {

        const taken = await Models.MigrateDemo.updateOne(
            { _id: migrateDemo._id, requests: { $elemMatch: { _id: request._id, emailSentAt: null } } },
            { $set: { 'requests.$.emailSentAt': new Date() } }
        )
        if (!taken.modifiedCount) {

            continue
        }
        await Promise.resolve()
            .then(() => send(request.email, demoUrl, Models))
            .then(() => sent++)
            .catch((err) => {

                failed++
                console.error(`[migrateDemos] ${migrateDemo._id} email failed`, err.message)
                return Models.MigrateDemo.updateOne(
                    { _id: migrateDemo._id, 'requests._id': request._id },
                    { $unset: { 'requests.$.emailSentAt': 1 } }
                )
            })
    }
    return { sent, failed }
}

export default {
    migrateDemoProvider,
    enqueueProcessMigrateDemo,
    upsertMigrateDemo,
    countRecentRequests,
    claimMigrateDemoRequest,
    claimMigrateDemoRequests,
    claimMigrateDemosForUser,
    sendMigrateDemoEmails
}
