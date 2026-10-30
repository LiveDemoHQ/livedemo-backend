import crypto from 'crypto'
import enqueueJob from '../enqueueJob.js'
import { hashToken } from '../authHelpers.js'

// "Make it yours" (OWNABLE_DEMOS_TECH_DESIGN.md): who may claim what, claim tokens, the claim-on-auth hook

export const MAX_OWN_CLONE_STORIES = 25
// Claim link lifetimes the author can pick in the editor; 0 = never expires
export const CLAIM_TOKEN_TTL_HOURS = [0, 1, 2, 24, 168]
const DEFAULT_CLAIM_TOKEN_TTL_HOURS = 2
const HEX24 = /^[a-f0-9]{24}$/i
const SESSION_ID = /^[A-Za-z0-9_-]{8,100}$/
// A claim stuck in cloning this long is treated as dead and may be retried
const IN_FLIGHT_MS = 10 * 60 * 1000

export const OWN_KINDS = {
    story: { model: 'Story', editorPath: (workspaceId, id) => `/workspace/${workspaceId}/storydemo/${id}` },
    agent: { model: 'AiDemoAgent', editorPath: (workspaceId, id) => `/workspace/${workspaceId}/aidemoagent/${id}` },
    showcase: { model: 'Showcase', editorPath: (workspaceId, id) => `/workspace/${workspaceId}/showcase/${id}` }
}

export const isOwnKind = kind => typeof kind === 'string' && Object.prototype.hasOwnProperty.call(OWN_KINDS, kind)
// Cheap "show the Make it yours button?" flag for preview payloads, so pages only call
// /own-claims/eligibility for content that can be claimed. Eligibility still does the full check.
export const isClaimable = doc => !!doc && doc.isPublished === true && !!doc.ownable && doc.ownable.enabled === true
export const isObjectIdString = value => HEX24.test(String(value || ''))
// Query values reach Mongo filters: only plain id strings, never objects ({ $ne: null })
export const cleanSessionId = value => (typeof value === 'string' && SESSION_ID.test(value) ? value : null)

// Claimable = published + ownable.enabled + the user who enabled it still has the flag. null otherwise
export async function loadOwnableSource(Models, kind, id) {
    if (!isOwnKind(kind) || !isObjectIdString(id)) return null

    const doc = await Models[OWN_KINDS[kind].model].findOne({ _id: id, deletedAt: null })
        .select('name workspaceId isPublished ownable')
        .lean()
    const ownable = doc && doc.ownable
    if (!doc || doc.isPublished !== true || !ownable || ownable.enabled !== true || !ownable.enabledBy) return null

    const author = await Models.User.findById(ownable.enabledBy).select('featureFlags').lean()
    if (!author || !author.featureFlags || author.featureFlags.allowOwnableContent !== true) return null

    return {
        _id: doc._id,
        kind,
        name: doc.name || '',
        workspaceId: doc.workspaceId,
        ctaLabel: ownable.ctaLabel || '',
        includeKnowledge: ownable.includeKnowledge === true,
        claimTokenTtlHours: CLAIM_TOKEN_TTL_HOURS.includes(ownable.claimTokenTtlHours) ? ownable.claimTokenTtlHours : DEFAULT_CLAIM_TOKEN_TTL_HOURS
    }
}

// Proves a claim started from a preview page. Not tied to a user; only the SHA-256 is stored
// ponytail: "never" tokens (expiresAt null) are skipped by the TTL index, so one row per preview view stays forever.
// Upgrade: reuse a token per browser session, or prune rows whose source is no longer ownable.
export async function createClaimToken(Models, source, now = Date.now()) {
    const token = crypto.randomBytes(32).toString('hex')
    await Models.OwnClaimToken.create({
        token: hashToken(token),
        sourceKind: source.kind,
        sourceId: source._id,
        expiresAt: source.claimTokenTtlHours ? new Date(now + source.claimTokenTtlHours * 60 * 60 * 1000) : null
    })
    return token
}

export async function verifyClaimToken(Models, token, kind, id, now = Date.now()) {
    if (typeof token !== 'string' || !token || !isOwnKind(kind) || !isObjectIdString(id)) return false
    const found = await Models.OwnClaimToken.exists({
        token: hashToken(token),
        sourceKind: kind,
        sourceId: id,
        expiresAt: { $not: { $lte: new Date(now) } }
    })
    return !!found
}

// The claimer's live copy of this source in this workspace, or a claim still cloning it
export async function findExistingClaim(Models, { userId, workspaceId, kind, sourceId }, includeInFlight = false) {
    const claims = await Models.OwnClaim.find({
        userId,
        workspaceId,
        sourceKind: kind,
        sourceId,
        status: { $in: includeInFlight ? ['completed', 'cloning'] : ['completed'] }
    }).sort({ createdAt: -1 }).lean()

    for (const claim of claims) {
        if (claim.status === 'cloning') {
            if (Date.now() - new Date(claim.updatedAt).getTime() < IN_FLIGHT_MS) return claim
            continue
        }
        const alive = await Models[OWN_KINDS[kind].model].exists({ _id: claim.clonedId, deletedAt: null })
        if (alive) return claim
    }
    return null
}

export function enqueueOwnClaim(claimId) {
    return enqueueJob('ownClaims', 'processOwnClaim', { claimId: String(claimId) })
}

export const firstWorkspaceId = userDoc => {
    const first = userDoc.workspaces && userDoc.workspaces[0]
    return first && first._id ? first._id : first
}

// Runs on every signup / login with a browserSessionId. Only finishes claims this browser session
// started by clicking "Make it yours"; never clones on its own. Enqueues, so login stays fast
export async function claimOwnRequestsForUser(browserSessionId, userDoc, Models) {
    const sessionId = cleanSessionId(browserSessionId)
    if (!sessionId || !userDoc) return
    const workspaceId = firstWorkspaceId(userDoc)
    if (!workspaceId) return

    const claims = await Models.OwnClaim.find({ browserSessionId: sessionId, userId: null, status: 'pending' }).lean()
    for (const claim of claims) {
        const existing = await findExistingClaim(Models, {
            userId: userDoc._id,
            workspaceId,
            kind: claim.sourceKind,
            sourceId: claim.sourceId
        })
        await Models.OwnClaim.updateOne({ _id: claim._id }, {
            $set: existing
                ? {
                    userId: userDoc._id,
                    workspaceId,
                    status: 'completed',
                    clonedId: existing.clonedId,
                    completedAt: new Date()
                }
                : {
                    userId: userDoc._id,
                    workspaceId,
                    status: 'cloning'
                }
        })
        if (!existing) await enqueueOwnClaim(claim._id)
    }
}
