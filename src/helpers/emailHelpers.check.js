// Self-check: own-claim / UrlDemo skip onboarding → editor. Run: node src/helpers/emailHelpers.check.js
import assert from 'assert'
import { getPostAuthRedirectPath, shouldRedirectToOnboarding } from './emailHelpers.js'

import logger from './logger.js'

const user = (overrides = {}) => ({
    _id: 'u1',
    emailVerified: true,
    workspaces: ['w1'],
    onboarding: { goals: [] },
    ...overrides
})

const Models = (opts = {}) => ({
    OwnClaim: {
        findOne: (q) => ({
            sort: () => ({
                select: () => ({
                    lean: async () => {
                        if (q.status === 'cloning') return opts.cloning || null
                        if (q.status === 'completed') return opts.justDone || null
                        return null
                    }
                })
            })
        }),
        exists: async (q) => !!((q.status === 'completed' || (q.status && q.status.$in && q.status.$in.includes('completed'))) && opts.everOwnClaimed)
    },
    UrlDemo: {
        findOne: () => ({
            sort: () => ({
                select: () => ({
                    lean: async () => opts.justUrlDemo || null
                })
            })
        }),
        exists: async () => !!opts.everUrlDemo
    },
    Story: { exists: async () => !!opts.hasDemo },
    AiDemoAgent: { exists: async () => !!opts.hasAgent },
    User: { updateOne: async () => { if (opts.onActivated) opts.onActivated() } }
})

assert.equal(shouldRedirectToOnboarding(user()), true)
assert.equal(shouldRedirectToOnboarding(user({ onboarding: { goals: ['sales'] } })), false)

assert.equal(await getPostAuthRedirectPath(user({ emailVerified: false }), Models()), '/onboarding')
assert.equal(await getPostAuthRedirectPath(user(), Models()), '/onboarding')
assert.equal(
    await getPostAuthRedirectPath(user(), Models({ cloning: { _id: 'c1' } })),
    '/own/claim/c1'
)
assert.equal(
    await getPostAuthRedirectPath(user(), Models({ justDone: { _id: 'c2' } })),
    '/own/claim/c2'
)
assert.equal(
    await getPostAuthRedirectPath(user(), Models({ justUrlDemo: { storyId: 's1' } })),
    '/workspace/w1/storydemo/s1'
)
// Onboarding is mandatory until the user has a demo
assert.equal(await getPostAuthRedirectPath(user({ onboarding: { goals: ['sales'] } }), Models(), '/'), '/onboarding')
assert.equal(await getPostAuthRedirectPath(user(), Models({ hasDemo: true }), '/workspace/x'), '/workspace/x')
assert.equal(await getPostAuthRedirectPath(user(), Models({ hasDemo: true })), '/')
// Cloned / migrated / URL demos skip onboarding even before the copy lands in the workspace
assert.equal(await getPostAuthRedirectPath(user(), Models({ everOwnClaimed: true }), '/'), '/')
assert.equal(await getPostAuthRedirectPath(user(), Models({ everUrlDemo: true }), '/'), '/')
assert.equal(await getPostAuthRedirectPath(user(), Models({ hasAgent: true }), '/'), '/')
// activated is sticky: no lookups once set, and it is persisted the first time a check passes
assert.equal(await getPostAuthRedirectPath(user({ activated: true }), Models(), '/'), '/')
let persisted = 0
await getPostAuthRedirectPath(user(), Models({ hasDemo: true, onActivated: () => { persisted++ } }), '/')
assert.equal(persisted, 1)

logger.info('emailHelpers.check.js: ok', { eventName: 'EMAILHELPERS_CHECK_JS_OK' })
