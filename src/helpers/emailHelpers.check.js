// Self-check: own-claim / UrlDemo skip onboarding → editor. Run: node src/helpers/emailHelpers.check.js
import assert from 'assert'
import { getPostAuthRedirectPath, shouldRedirectToOnboarding } from './emailHelpers.js'

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
        exists: async (q) => !!(q.status === 'completed' && opts.everOwnClaimed)
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
    }
})

assert.equal(shouldRedirectToOnboarding(user()), true)
assert.equal(shouldRedirectToOnboarding(user({ onboarding: { goals: ['sales'] } })), false)

assert.equal(await getPostAuthRedirectPath(user({ emailVerified: false }), Models()), '/email-verify')
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
assert.equal(
    await getPostAuthRedirectPath(user(), Models({ everOwnClaimed: true }), '/workspace/x'),
    '/workspace/x'
)
assert.equal(
    await getPostAuthRedirectPath(user(), Models({ everUrlDemo: true }), '/'),
    '/'
)

console.log('emailHelpers.check.js: ok')
