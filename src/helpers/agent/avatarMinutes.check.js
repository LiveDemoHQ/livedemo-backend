// Self-check for avatarMinutes.js
// Run: AVATAR_MINUTES_ENFORCED=true PRIVATE_AUTH_TOKEN=x ANAM_API_KEY=ours-anam LEMONSLICE_API_KEY=ours-ls node src/helpers/agent/avatarMinutes.check.js
import assert from 'assert'
import mongoose from 'mongoose'
import { sealKey } from './providerKeys.js'
import { avatarLimitsFor } from '../subscriptionHelpers.js'
import AvatarUsageSchema from '../../models/AvatarUsage.js'
import {

    periodOf,
    heartbeatDelta,
    remainingSeconds,
    creditsForSeconds,
    creditsForMinutes,
    mergeLimits,
    avatarAccess,
    claimSlot,
    STALE_MS
} from './avatarMinutes.js'
import logger from '../logger.js'

assert.ok(process.env.AVATAR_MINUTES_ENFORCED, 'set AVATAR_MINUTES_ENFORCED=true')

assert.strictEqual(periodOf(new Date('2026-10-31T23:59:59Z')), '2026-10')
assert.strictEqual(periodOf(new Date('2026-11-01T00:00:00Z')), '2026-11')

const now = new Date('2026-10-19T12:00:00Z')
assert.strictEqual(heartbeatDelta(new Date(now.getTime() - 20000), now), 20)
assert.strictEqual(heartbeatDelta(new Date(now.getTime() - 60 * 60 * 1000), now), 30)
assert.strictEqual(heartbeatDelta(new Date(now.getTime() + 5000), now), 0)

assert.strictEqual(remainingSeconds(3600, 3599), 1)
assert.strictEqual(remainingSeconds(3600, 4000), 0)
assert.strictEqual(creditsForSeconds(3600), 1000)
assert.strictEqual(creditsForMinutes(60), 1000)
assert.strictEqual(creditsForSeconds(0), 0)

assert.deepStrictEqual(mergeLimits([]), { sessionAvatarTime: 0, concurrentSessionAvatars: 0 })
assert.deepStrictEqual(mergeLimits([{}]), { sessionAvatarTime: 0, concurrentSessionAvatars: 0 })
assert.deepStrictEqual(mergeLimits([
    { sessionAvatarTime: 60, concurrentSessionAvatars: 1 },
    { sessionAvatarTime: 300, concurrentSessionAvatars: 3 }
]), { sessionAvatarTime: 300, concurrentSessionAvatars: 3 })

assert.deepStrictEqual(avatarLimitsFor('growth_monthly'), { sessionAvatarTime: 60, concurrentSessionAvatars: 1 })
assert.deepStrictEqual(avatarLimitsFor('pro_monthly'), { sessionAvatarTime: 0, concurrentSessionAvatars: 0 })

const KEY = 'sk_live_abcdefghijklmnop1234'

function models({ workspace, subs, used }) {
    return {
        Workspace: {
            findById: () => ({ select: () => ({ lean: async () => workspace }) })
        },
        Subscription: {
            find: () => ({ select: () => ({ lean: async () => subs }) })
        },
        AvatarUsage: {
            aggregate: async () => (used ? [{ seconds: used }] : [])
        }
    }
}

async function expectCode(fn, code) {
    try {
        await fn()
        assert.fail(`expected ${code}`)
    } catch (err) {
        assert.strictEqual(err.code, code, err.message)
    }
}

const growth = { sessionAvatarTime: 60, concurrentSessionAvatars: 1 }
const ownWorkspace = {
    _id: 'ws1',
    type: 'growth',
    providerKeys: { anam: { enc: sealKey('anam', KEY, 'ws1') } }
}

const own = await avatarAccess(models({ workspace: ownWorkspace, subs: [], used: 99999 }), 'ws1', 'anam')
assert.strictEqual(own.ownKey, true)
assert.strictEqual(own.apiKey, KEY)
assert.strictEqual(own.remainingSeconds, Infinity)

await expectCode(
    () => avatarAccess(models({ workspace: { _id: 'ws1', type: 'pro' }, subs: [], used: 0 }), 'ws1', 'anam'),
    'avatar_not_in_plan'
)

await expectCode(
    () => avatarAccess(models({ workspace: { _id: 'ws1', type: 'growth' }, subs: [growth], used: 3600 }), 'ws1', 'anam'),
    'avatar_minutes_exhausted'
)

const open = await avatarAccess(models({ workspace: { _id: 'ws1', type: 'growth' }, subs: [growth], used: 0 }), 'ws1', 'anam')
assert.strictEqual(open.remainingSeconds, 3600)
assert.strictEqual(open.ownKey, false)

async function slotChecks() {
    let conn
    try {
        conn = await mongoose.createConnection('mongodb://127.0.0.1:27017/avatar_minutes_check', {
            serverSelectionTimeoutMS: 2000
        }).asPromise()
    } catch (err) {
        logger.error('slot checks skipped, no local mongo:', { eventName: 'SLOT_CHECKS_SKIPPED_NO_LOCAL_MONGO_FAILED', err: err.message })
        return
    }

    const AvatarUsage = conn.model('AvatarUsage', AvatarUsageSchema)
    await AvatarUsage.createIndexes()
    const Models = { AvatarUsage, Workspace: { findById: () => ({ select: () => ({ lean: async () => null }) }) } }
    const workspaceId = new mongoose.Types.ObjectId()
    const agentId = new mongoose.Types.ObjectId()
    const base = {
        workspaceId,
        agentId,
        provider: 'anam',
        ownKey: false,
        period: '2026-10',
        limitSeconds: 3600,
        startedAt: new Date(),
        lastSeenAt: new Date()
    }

    const [first, second] = await Promise.all([
        claimSlot(Models, { ...base }, 1).then(row => ({ ok: true, row })).catch(err => ({ ok: false, code: err.code })),
        claimSlot(Models, { ...base }, 1).then(row => ({ ok: true, row })).catch(err => ({ ok: false, code: err.code }))
    ])
    const won = [first, second].filter(r => r.ok)
    const lost = [first, second].filter(r => !r.ok)
    assert.strictEqual(won.length, 1, 'one slot')
    assert.strictEqual(lost[0].code, 'avatar_busy')

    await AvatarUsage.updateOne({ _id: won[0].row._id }, { $set: { endedAt: new Date(), endReason: 'client' }, $unset: { slot: 1 } })
    const again = await claimSlot(Models, { ...base, lastSeenAt: new Date() }, 1)
    assert.strictEqual(again.slot, 0)

    const workspaceId2 = new mongoose.Types.ObjectId()
    const parallel = await Promise.all([0, 1, 2].map(() => claimSlot(Models, { ...base, workspaceId: workspaceId2 }, 2)
        .then(row => ({ ok: true, slot: row.slot }))
        .catch(err => ({ ok: false, code: err.code }))))
    assert.strictEqual(parallel.filter(r => r.ok).length, 2)
    assert.deepStrictEqual(parallel.filter(r => r.ok).map(r => r.slot).sort(), [0, 1])

    const workspaceId3 = new mongoose.Types.ObjectId()
    const stale = await AvatarUsage.create({
        ...base,
        workspaceId: workspaceId3,
        slot: 0,
        lastSeenAt: new Date(Date.now() - STALE_MS - 1000)
    })
    const taken = await claimSlot(Models, { ...base, workspaceId: workspaceId3 }, 1)
    assert.strictEqual(String(taken._id) === String(stale._id), false)
    const closed = await AvatarUsage.findById(stale._id)
    assert.strictEqual(closed.endReason, 'stale')
    assert.strictEqual(closed.slot, undefined)

    const ownRow = await claimSlot(Models, { ...base, ownKey: true }, 1)
    const ownRow2 = await claimSlot(Models, { ...base, ownKey: true }, 1)
    assert.strictEqual(ownRow.slot, undefined)
    assert.strictEqual(ownRow2.slot, undefined)

    await conn.dropDatabase()
    await conn.close()
    logger.info('slot checks passed', { eventName: 'SLOT_CHECKS_PASSED' })
}

await slotChecks()
logger.info('avatarMinutes.check passed', { eventName: 'AVATARMINUTES_CHECK_PASSED' })
