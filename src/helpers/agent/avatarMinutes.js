import mongoose from 'mongoose'
import ENV from '../../envServer.js'
import ResponseCodes from '../../constants/ResponseCodes.js'
import AvatarMinutes from '../../constants/AvatarMinutes.js'
import { subscriptionWorkspaceFilter } from '../subscriptionHelpers.js'
import { resolveKeyInfo } from './providerKeys.js'
import { CORS_HEADERS } from './http.js'
import { terminateSession } from './lemonslice.js'

export const HEARTBEAT_MS = AvatarMinutes.HEARTBEAT_MS
export const MAX_DELTA_MS = AvatarMinutes.MAX_DELTA_MS
export const STALE_MS = AvatarMinutes.STALE_MS
export const MAX_SESSION_SECONDS = AvatarMinutes.MAX_SESSION_SECONDS

export function enforced() {
    return !!ENV.AVATAR_MINUTES_ENFORCED
}

export function periodOf(date) {
    const y = date.getUTCFullYear()
    const m = String(date.getUTCMonth() + 1).padStart(2, '0')
    return `${y}-${m}`
}

export function resetsAt(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
}

// Seconds to bill for one heartbeat. A tab that slept bills the cap, not the gap.
export function heartbeatDelta(lastSeenAt, now) {
    const ms = new Date(now).getTime() - new Date(lastSeenAt).getTime()
    return Math.round(Math.min(Math.max(ms, 0), MAX_DELTA_MS) / 1000)
}

export function remainingSeconds(limitSeconds, usedSeconds) {
    return Math.max(0, (Number(limitSeconds) || 0) - (Number(usedSeconds) || 0))
}

// Several active subscriptions on one workspace: the higher of each field wins.
export function mergeLimits(subscriptions) {
    return (subscriptions || []).reduce((acc, sub) => ({
        sessionAvatarTime: Math.max(acc.sessionAvatarTime, Number(sub && sub.sessionAvatarTime) || 0),
        concurrentSessionAvatars: Math.max(acc.concurrentSessionAvatars, Number(sub && sub.concurrentSessionAvatars) || 0)
    }), {
        sessionAvatarTime: 0,
        concurrentSessionAvatars: 0
    })
}

function limitError(statusCode, code, message) {
    const error = new Error(message)
    error.code = code
    error.resultResponse = {
        statusCode,
        headers: CORS_HEADERS,
        body: JSON.stringify({ message, code })
    }
    throw error
}

function asId(id) {
    if (id instanceof mongoose.Types.ObjectId) return id
    const str = String(id)
    if (/^[a-f0-9]{24}$/i.test(str)) return new mongoose.Types.ObjectId(str)
    return id
}

async function workspaceKeyInfo(Models, workspaceId, provider) {
    const workspace = await Models.Workspace.findById(workspaceId).select('type +providerKeys').lean()
    return resolveKeyInfo(workspace, provider)
}

export async function workspaceAvatarLimits(Models, workspaceId) {
    const subs = await Models.Subscription.find({
        ...subscriptionWorkspaceFilter(workspaceId),
        active: true
    }).select('sessionAvatarTime concurrentSessionAvatars').lean()
    return mergeLimits(subs)
}

export async function usedSeconds(Models, workspaceId, period) {
    const [row] = await Models.AvatarUsage.aggregate([
        { $match: { workspaceId: asId(workspaceId), period, ownKey: false } },
        { $group: { _id: null, seconds: { $sum: '$seconds' } } }
    ])
    return (row && row.seconds) || 0
}

// Recorded, never counted toward the plan limit.
export async function ownKeySeconds(Models, workspaceId, period) {
    const rows = await Models.AvatarUsage.aggregate([
        { $match: { workspaceId: asId(workspaceId), period, ownKey: true } },
        { $group: { _id: '$provider', seconds: { $sum: '$seconds' } } }
    ])
    const out = { anam: 0, lemonslice: 0 }
    for (const row of rows) {

        if (row._id === 'lemonslice') out.lemonslice = row.seconds || 0
        else if (row._id === 'anam') out.anam = row.seconds || 0
    }
    return out
}

// { apiKey, ownKey, limitSeconds, remainingSeconds, concurrent } or throws when enforced.
export async function avatarAccess(Models, workspaceId, provider) {
    const info = await workspaceKeyInfo(Models, workspaceId, provider)

    if (info.ownKey) {

        return {
            apiKey: info.apiKey,
            ownKey: true,
            limitSeconds: 0,
            remainingSeconds: Infinity,
            concurrent: 0
        }
    }

    const limits = await workspaceAvatarLimits(Models, workspaceId)
    if (enforced() && (!limits.sessionAvatarTime || !limits.concurrentSessionAvatars)) {

        limitError(ResponseCodes['403_FORBIDDEN'], 'avatar_not_in_plan', 'Live avatars are not included in this plan')
    }

    const limitSeconds = limits.sessionAvatarTime * 60
    const used = await usedSeconds(Models, workspaceId, periodOf(new Date()))
    const remaining = remainingSeconds(limitSeconds, used)

    if (enforced() && remaining <= 0) {

        limitError(ResponseCodes['402_PAYMENT_REQUIRED'], 'avatar_minutes_exhausted', 'Avatar minutes for this month are used up')
    }

    return {
        apiKey: info.apiKey,
        ownKey: false,
        limitSeconds,
        remainingSeconds: remaining,
        concurrent: limits.concurrentSessionAvatars
    }
}

// Cap a session on our Anam key so a client that never heartbeats still stops.
export function anamSessionCap(access) {
    if (access.ownKey) return undefined
    const remaining = access.remainingSeconds > 0 ? access.remainingSeconds : MAX_SESSION_SECONDS
    return Math.min(MAX_SESSION_SECONDS, remaining)
}

async function insertSlot(Models, row, slot) {
    try {
        return await Models.AvatarUsage.create(slot === undefined ? row : { ...row, slot })
    } catch (err) {
        if (err && err.code === 11000) return null
        throw err
    }
}

// Close a holder whose tab is gone and return its slot, or null.
async function takeoverStale(Models, workspaceId) {
    const holder = await Models.AvatarUsage.findOne({
        workspaceId,
        slot: { $exists: true },
        endedAt: null,
        lastSeenAt: { $lt: new Date(Date.now() - STALE_MS) }
    }).sort({ lastSeenAt: 1 }).select('+controlUrl')

    if (!holder) return null

    const claimed = await Models.AvatarUsage.updateOne(
        { _id: holder._id, endedAt: null },
        { $set: { endedAt: holder.lastSeenAt, endReason: 'stale' }, $unset: { slot: 1 } }
    )

    if (!claimed.modifiedCount) return null

    await terminateUsage(Models, holder)
    return holder.slot
}

// Claim a concurrency slot before the vendor call. Own-key rows take no slot.
export async function claimSlot(Models, row, concurrent) {
    if (row.ownKey || !concurrent) return Models.AvatarUsage.create(row)

    for (let slot = 0; slot < concurrent; slot++) {
        const created = await insertSlot(Models, row, slot)
        if (created) return created
    }

    const freed = await takeoverStale(Models, row.workspaceId)
    if (freed !== null && freed !== undefined) {

        const created = await insertSlot(Models, row, freed)
        if (created) return created
    }

    if (!enforced()) {

        console.log('[avatarMinutes] would be 409', String(row.workspaceId))
        return Models.AvatarUsage.create(row)
    }

    limitError(ResponseCodes['409_CONFLICT'], 'avatar_busy', 'Another live avatar is already running')
}

export async function terminateUsage(Models, row) {
    if (!row || row.provider !== 'lemonslice' || !row.controlUrl) return
    const info = await workspaceKeyInfo(Models, row.workspaceId, 'lemonslice')
    terminateSession({ control_url: row.controlUrl }, info.apiKey)
}

// Vendor start failed: free the slot and stop a LemonSlice face we already opened.
export async function failAvatarSession(Models, row) {
    if (!row || !row._id) return

    await Models.AvatarUsage.updateOne(
        { _id: row._id, endedAt: null },
        { $set: { endedAt: new Date(), endReason: 'start_failed', seconds: 0 }, $unset: { slot: 1 } }
    )
    await terminateUsage(Models, row)
}

export async function beginAvatarSession(Models, agent, provider) {
    const access = await avatarAccess(Models, agent.workspaceId, provider)
    const now = new Date()
    const row = await claimSlot(Models, {
        workspaceId: agent.workspaceId,
        agentId: agent._id,
        provider,
        ownKey: access.ownKey,
        period: periodOf(now),
        limitSeconds: access.ownKey ? 0 : access.limitSeconds,
        startedAt: now,
        lastSeenAt: now
    }, access.ownKey ? 0 : access.concurrent)

    return { access, row }
}

// Add the gap since lastSeenAt. Returns false when another request already did.
export async function touchUsage(Models, row, now, endReason) {
    const delta = heartbeatDelta(row.lastSeenAt, now)
    const update = endReason
        ? {
            $inc: { seconds: delta },
            $set: { lastSeenAt: now, endedAt: now, endReason },
            $unset: { slot: 1 }
        }
        : {
            $inc: { seconds: delta },
            $set: { lastSeenAt: now }
        }
    const updated = await Models.AvatarUsage.updateOne(
        { _id: row._id, endedAt: null, lastSeenAt: row.lastSeenAt },
        update
    )
    return { applied: !!updated.modifiedCount, delta }
}

// After a heartbeat: stop the face when the snapshotted monthly limit is used up.
export async function limitReached(Models, row) {
    if (row.ownKey || !enforced()) return false
    const used = await usedSeconds(Models, row.workspaceId, row.period)
    return remainingSeconds(row.limitSeconds, used) <= 0
}

export async function stopForLimit(Models, row, now) {
    const updated = await Models.AvatarUsage.updateOne(
        { _id: row._id, endedAt: null },
        { $set: { endedAt: now, endReason: 'limit' }, $unset: { slot: 1 } }
    )
    if (updated.modifiedCount) await terminateUsage(Models, row)
}

export async function loadOpenUsage(Models, agentId, usageId) {
    if (!mongoose.Types.ObjectId.isValid(String(usageId || '')) || !mongoose.Types.ObjectId.isValid(String(agentId || ''))) return null
    return Models.AvatarUsage.findOne({ _id: usageId, agentId, endedAt: null }).select('+controlUrl')
}

export async function closeStaleAvatarUsage(Models) {
    const cutoff = new Date(Date.now() - STALE_MS)
    const rows = await Models.AvatarUsage.find({
        endedAt: null,
        lastSeenAt: { $lt: cutoff }
    }).select('+controlUrl').limit(200)

    for (const row of rows) {
        const claimed = await Models.AvatarUsage.updateOne(
            { _id: row._id, endedAt: null },
            { $set: { endedAt: row.lastSeenAt, endReason: 'stale' }, $unset: { slot: 1 } }
        )

        if (claimed.modifiedCount) await terminateUsage(Models, row)
    }
}

// Player hint. Busy slots are not included: they change every few seconds.
export async function isAvatarAvailable(Models, agent) {
    const provider = agent.avatarProvider === 'lemonslice' ? 'lemonslice' : 'anam'
    const info = await workspaceKeyInfo(Models, agent.workspaceId, provider)
    if (info.ownKey || !enforced()) return true

    const limits = await workspaceAvatarLimits(Models, agent.workspaceId)
    if (!limits.sessionAvatarTime || !limits.concurrentSessionAvatars) return false

    const used = await usedSeconds(Models, agent.workspaceId, periodOf(new Date()))
    return remainingSeconds(limits.sessionAvatarTime * 60, used) > 0
}

export async function usageSummary(Models, workspaceId) {
    const now = new Date()
    const period = periodOf(now)
    const [workspace, limits, used, ownUsed, activeSessions] = await Promise.all([
        Models.Workspace.findById(workspaceId).select('type +providerKeys').lean(),
        workspaceAvatarLimits(Models, workspaceId),
        usedSeconds(Models, workspaceId, period),
        ownKeySeconds(Models, workspaceId, period),
        Models.AvatarUsage.countDocuments({ workspaceId, endedAt: null, slot: { $exists: true } })
    ])
    return {
        period,
        usedSeconds: used,
        ownKeySeconds: ownUsed,
        sessionAvatarTime: limits.sessionAvatarTime,
        concurrentSessionAvatars: limits.concurrentSessionAvatars,
        activeSessions,
        resetsAt: resetsAt(now).toISOString(),
        ownKeys: {
            anam: resolveKeyInfo(workspace, 'anam').ownKey,
            lemonslice: resolveKeyInfo(workspace, 'lemonslice').ownKey
        }
    }
}
