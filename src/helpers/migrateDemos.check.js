// Self-check for cloned-demo claims, emails and the internal routes — run: node src/helpers/migrateDemos.check.js
import assert from 'assert'

import logger from './logger.js'

process.env.INTERNAL_API_KEY = 'k'
process.env.SERVER_URL = 'https://app.test'
const { claimMigrateDemosForUser, claimMigrateDemoRequests, sendMigrateDemoEmails, migrateDemoProvider } = await import('./migrateDemos.js')
const { isInternalRequest } = await import('./internalAuth.js')
const { default: migrateDemos } = await import('../handlers/migrateDemos.js')

const id = n => String(n).padStart(24, '0')
const MIGRATE_WS = id(900)
const MIGRATE_USER = id(901)
const user = (n) => ({ _id: id(700 + n), workspaces: [{ _id: id(800 + n) }] })

// --- in-memory models: only the filters and updates migrateDemos.js / own.js use
const same = (value, cond) => {

    if (cond && typeof cond === 'object' && '$in' in cond) {

        return cond.$in.includes(value)
    }
    return cond === null ? value == null : String(value) === String(cond)
}
const matches = (doc, filter, pos = {}) => Object.entries(filter).every(([key, cond]) => {

    if (key === 'requests') {

        pos.i = doc.requests.findIndex(r => matches(r, cond.$elemMatch))
        return pos.i >= 0
    }
    if (key.startsWith('requests.')) {

        pos.i = doc.requests.findIndex(r => same(r[key.slice('requests.'.length)], cond))
        return pos.i >= 0
    }
    return same(doc[key], cond)
})
const lean = value => ({ lean: async () => value && structuredClone(value) })
const collection = rows => ({
    rows,
    find: filter => {

        const found = rows.filter(d => matches(d, filter))
        return { ...lean(found), sort: () => lean(found) }
    },
    findById: _id => lean(rows.find(d => String(d._id) === String(_id))),
    findOne: filter => ({ select: () => lean(rows.find(d => matches(d, filter))) }),
    exists: async filter => rows.some(d => matches(d, filter)),
    create: async doc => rows.push({ ...doc, createdAt: new Date(), updatedAt: new Date() }),
    updateOne: async (filter, update) => {

        const pos = {}
        const doc = rows.find(d => matches(d, filter, pos))
        if (!doc) {

            return { modifiedCount: 0 }
        }
        const target = key => (key.startsWith('requests.$.') ? [doc.requests[pos.i], key.slice('requests.$.'.length)] : [doc, key])
        Object.entries(update.$set || {}).forEach(([key, value]) => {

            const [obj, field] = target(key)
            obj[field] = value
        })
        Object.keys(update.$unset || {}).forEach((key) => {

            const [obj, field] = target(key)
            delete obj[field]
        })
        return { modifiedCount: 1 }
    }
})

const stories = [
    { _id: id(1), workspaceId: MIGRATE_WS, isPublished: true, ownable: { enabled: true, enabledBy: MIGRATE_USER } },
    { _id: id(2), workspaceId: MIGRATE_WS }
]
const Models = {
    MigrateDemo: collection([]),
    OwnClaim: collection([]),
    Story: collection(stories),
    User: { findById: () => ({ select: () => lean({ featureFlags: { allowOwnableContent: true } }) }) }
}
const enqueued = []
const enqueue = async claimId => enqueued.push(String(claimId))
const request = (n, fields) => ({
    _id: id(500 + n),
    email: `u${n}@x.com`,
    createdAt: new Date(),
    ...fields
})
const migrateDemo = (n, fields) => {

    const doc = {
        _id: id(600 + n),
        status: 'completed',
        storyId: id(1),
        requests: [],
        ...fields
    }
    Models.MigrateDemo.rows.push(doc)
    return doc
}

assert.strictEqual(migrateDemoProvider('https://app.storylane.io/share/abc'), 'storylane')
assert.strictEqual(migrateDemoProvider('https://demo.arcade.software/x'), 'arcade')
assert.strictEqual(migrateDemoProvider('https://navattic.com/x'), 'navattic')
assert.strictEqual(migrateDemoProvider('https://evilsupademo.com/x'), undefined, 'subdomains only, not lookalikes')

// --- registering with a session that requested a completed demo: one OwnClaim, enqueued
const done = migrateDemo(1, { requests: [request(1, { browserSessionId: 'session-aaaa' })] })
await claimMigrateDemosForUser('session-aaaa', user(1), Models, enqueue)
assert.strictEqual(Models.OwnClaim.rows.length, 1)
assert.deepStrictEqual(enqueued, [String(Models.OwnClaim.rows[0]._id)])
assert.strictEqual(String(Models.OwnClaim.rows[0].workspaceId), id(801))
assert.strictEqual(String(done.requests[0].ownClaimId), String(Models.OwnClaim.rows[0]._id))

// logging in twice, or the claims route racing the login, never enqueues it again
await claimMigrateDemosForUser('session-aaaa', user(1), Models, enqueue)
assert.strictEqual(await claimMigrateDemoRequests(Models, done._id, enqueue), 0)
assert.strictEqual(enqueued.length, 1)

// --- registering while the demo is still cloning only stamps claimUserId; the claims route enqueues it later
const cloning = migrateDemo(2, { status: 'processing', storyId: null, requests: [request(2, { browserSessionId: 'session-bbbb' })] })
await claimMigrateDemosForUser('session-bbbb', user(2), Models, enqueue)
assert.strictEqual(String(cloning.requests[0].claimUserId), id(702))
assert.strictEqual(cloning.requests[0].ownClaimId, undefined)
assert.strictEqual(enqueued.length, 1)
Object.assign(cloning, { status: 'completed', storyId: id(1) })
const routed = await Promise.all([claimMigrateDemoRequests(Models, cloning._id, enqueue), claimMigrateDemoRequests(Models, cloning._id, enqueue)])
assert.strictEqual(routed[0] + routed[1], 1)
assert.strictEqual(enqueued.length, 2, 'two overlapping claims calls enqueue once')

// --- a session that also clicked "Make it yours" on the same story gets one copy. claimOwnRequestsForUser runs
// first on login and leaves the click as a cloning claim of this user
Models.OwnClaim.rows.push({
    _id: id(400),
    browserSessionId: 'session-cccc',
    sourceKind: 'story',
    sourceId: id(1),
    userId: id(703),
    workspaceId: id(803),
    status: 'cloning',
    updatedAt: new Date()
})
const clicked = migrateDemo(3, { requests: [request(3, { browserSessionId: 'session-cccc' })] })
const claimsBefore = Models.OwnClaim.rows.length
await claimMigrateDemosForUser('session-cccc', user(3), Models, enqueue)
assert.strictEqual(Models.OwnClaim.rows.length, claimsBefore, 'no second OwnClaim')
assert.strictEqual(String(clicked.requests[0].ownClaimId), id(400))
assert.strictEqual(enqueued.length, 2)

// --- a clone over MAX_OWN_CLONE_STORIES was imported without ownable: no claim
const tooLarge = migrateDemo(4, { storyId: id(2), requests: [request(4, { browserSessionId: 'session-dddd' })] })
await claimMigrateDemosForUser('session-dddd', user(4), Models, enqueue)
assert.strictEqual(tooLarge.requests[0].ownClaimId, undefined)
assert.strictEqual(enqueued.length, 2)

// --- emails: each unsent request once, already-sent skipped, overlapping calls send once
const sent = []
let failFor = null
const send = async (email, demoUrl) => {

    await new Promise(resolve => setImmediate(resolve))
    if (email === failFor) {

        throw new Error('ses down')
    }
    sent.push({ email, demoUrl })
}
const mail = migrateDemo(5, {
    requests: [
        request(51),
        request(52, { emailSentAt: new Date() }),
        request(53),
        request(54, { email: undefined })
    ]
})
const fresh = () => structuredClone(Models.MigrateDemo.rows.find(d => d._id === mail._id))
const results = await Promise.all([sendMigrateDemoEmails(Models, fresh(), send), sendMigrateDemoEmails(Models, fresh(), send)])
assert.deepStrictEqual(sent.map(s => s.email).sort(), ['u51@x.com', 'u53@x.com'])
assert.strictEqual(results[0].sent + results[1].sent, 2)
assert.strictEqual(sent[0].demoUrl, `https://app.test/migrate-demo?migrateDemoId=${mail._id}`)
assert.deepStrictEqual(await sendMigrateDemoEmails(Models, fresh(), send), { sent: 0, failed: 0 })

// a failed send releases its request for the next call and doesn't stop the others
mail.requests.push(request(55), request(56))
failFor = 'u55@x.com'
assert.deepStrictEqual(await sendMigrateDemoEmails(Models, fresh(), send), { sent: 1, failed: 1 })
assert.strictEqual(mail.requests.find(r => r._id === id(555)).emailSentAt, undefined)
failFor = null
assert.deepStrictEqual(await sendMigrateDemoEmails(Models, fresh(), send), { sent: 1, failed: 0 })

// --- internal routes: 401 without the right key, 409 when not completed
const req = auth => ({ get: () => auth })
assert.ok(isInternalRequest(req('Internal k')))
for (const auth of [undefined, 'Internal', 'Internal x', 'Bearer k', 'Internal kk']) assert.ok(!isInternalRequest(req(auth)), auth)
const call = (handler, auth, params) => new Promise((resolve) => {

    const res = {
        statusCode: 200,
        status(code) {

            this.statusCode = code
            return this
        },
        send: () => resolve(res.statusCode),
        json: () => resolve(res.statusCode)
    }
    handler({ get: () => auth, params, mongo: { Models } }, res)
})
assert.strictEqual(await call(migrateDemos.postInternalEmails, 'Bearer k', { migrateDemoId: mail._id }), 401)
assert.strictEqual(await call(migrateDemos.postInternalClaims, undefined, { migrateDemoId: mail._id }), 401)
assert.strictEqual(await call(migrateDemos.postInternalEmails, 'Internal k', { migrateDemoId: migrateDemo(6, { status: 'processing' })._id }), 409)
assert.strictEqual(await call(migrateDemos.postInternalClaims, 'Internal k', { migrateDemoId: done._id }), 200)

logger.info('migrateDemos.check.js OK', { eventName: 'MIGRATEDEMOS_CHECK_JS_OK' })
process.exit(0)
