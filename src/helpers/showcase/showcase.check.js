// Self-check for showcases — run: node src/helpers/showcase/showcase.check.js
// normalizeShowcase is the trust boundary for edits; resolveItems + the player decide what visitors see.
import assert from 'assert'
import normalizeShowcase, { videoEmbed } from './normalizeShowcase.js'
import { resolveItems } from './showcase.js'
import playerHandler from '../../handlers/getShowcasePlayer.js'

import logger from '../logger.js'

const WS = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const STORY = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const DRAFT = 'cccccccccccccccccccccccc'
const OTHER_WS_STORY = 'dddddddddddddddddddddddd'

const stories = [
    { _id: STORY, workspaceId: WS, name: 'Setup SSO', thumbnailImageUrl: 'https://cdn/x.png', isPublished: true },
    { _id: DRAFT, workspaceId: WS, name: 'WIP', thumbnailImageUrl: 'https://cdn/y.png', isPublished: false },
    { _id: OTHER_WS_STORY, workspaceId: 'eeeeeeeeeeeeeeeeeeeeeeee', name: 'Not yours', isPublished: true }
]
const finder = docs => ({
    find: query => ({
        select: () => ({
            lean: async () => docs.filter(d => query._id.$in.map(String).includes(String(d._id)) && (!query.workspaceId || String(d.workspaceId) === String(query.workspaceId)))
        })
    })
})
const Models = { Story: finder(stories), AiDemoAgent: finder([]) }
const showcase = { workspaceId: WS, sections: [], facets: [], items: [] }
const user = { featureFlags: { allowRemoveWatermark: false } }
const rejects = (body, pattern, message) => assert.rejects(normalizeShowcase(Models, showcase, user, body), pattern, message)

// Whitelist + dotted $set
const updates = await normalizeShowcase(Models, showcase, user, { name: '  Hub ', theme: { accentColor: '#FF0000' }, userId: 'x', isPublished: true })
assert.deepStrictEqual(updates, { name: 'Hub', 'theme.accentColor': '#FF0000' })

await rejects({ items: [{ kind: 'demo', storyId: OTHER_WS_STORY }] }, /belong to this workspace/, 'cross-workspace story must be rejected')
await rejects({ theme: { accentColor: 'red;}body{display:none' } }, /#rrggbb/, 'CSS injection via color')
await rejects({ items: [{ kind: 'video', url: 'https://evil.com/watch?v=abcdef' }] }, /YouTube/)
await rejects({ items: [{ kind: 'link', url: 'http://example.com' }] }, /https/)
await rejects({ items: [{ kind: 'link', url: 'https://127.0.0.1/admin' }] }, /public host/, 'private IPs blocked')
await rejects({ embed: { showBranding: false } }, /Upgrade/, 'branding removal is a plan gate')
await rejects({ items: Array.from({ length: 101 }, () => ({ kind: 'demo', storyId: STORY })) }, /Up to 100/)

// Unknown section / facet ids are dropped, duplicate item ids regenerated
const linked = await normalizeShowcase(Models, showcase, user, {
    sections: [{ _id: 's1', title: 'Basics' }],
    facets: [{ _id: 'f1', name: 'Persona', options: [{ _id: 'o1', name: 'Dev' }] }],
    items: [
        { _id: 'i1', kind: 'demo', storyId: STORY, sectionId: 's1', facetOptionIds: ['o1', 'ghost'] },
        { _id: 'i1', kind: 'demo', storyId: STORY, sectionId: 'nope' }
    ]
})
assert.strictEqual(linked.items[0].sectionId, 's1')
assert.deepStrictEqual(linked.items[0].facetOptionIds, ['o1'])
assert.strictEqual(linked.items[1].sectionId, null)
assert.notStrictEqual(linked.items[1]._id, 'i1')

assert.strictEqual(videoEmbed('https://youtu.be/dQw4w9WgXcQ').embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&autoplay=1')
assert.strictEqual(videoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ').thumbnailUrl, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
assert.strictEqual(videoEmbed('https://vimeo.com/76979871').embedUrl, 'https://player.vimeo.com/video/76979871?autoplay=1')
assert.strictEqual(videoEmbed('https://www.youtube.com/watch?v="><script>'), null)

// Published mode: drafts, hidden and missing refs never reach visitors
const doc = {
    workspaceId: WS,
    items: [
        { _id: 'a', kind: 'demo', storyId: STORY },
        { _id: 'b', kind: 'demo', storyId: DRAFT },
        { _id: 'c', kind: 'demo', storyId: STORY, hidden: true },
        { _id: 'd', kind: 'demo', storyId: OTHER_WS_STORY }
    ]
}
assert.deepStrictEqual((await resolveItems(Models, doc, 'published')).map(i => i._id), ['a'])
const editorItems = await resolveItems(Models, doc, 'editor')
assert.deepStrictEqual(editorItems.map(i => [i._id, i.draft, i.hidden, i.missing]), [
    ['a', false, false, false],
    ['b', true, false, false],
    ['c', false, true, false],
    ['d', false, false, true]
])

// Player shell: escaping, payload hygiene, embed gate
function fakeRes() {
    const res = { headers: {}, status(code) { res.code = code; return res }, set(h) { Object.assign(res.headers, h) }, send(body) { res.body = body } }
    return res
}
const published = {
    _id: 'ffffffffffffffffffffffff',
    workspaceId: WS,
    name: 'Evil</script><script>alert(1)</script>',
    isPublished: true,
    userId: 'SECRET_USER',
    embed: { enabled: false, allowedDomains: [], showBranding: true },
    items: doc.items
}
const playerModels = { ...Models, Showcase: { findOne: async () => published } }
const req = query => ({ mongo: { Models: playerModels }, params: { showcaseId: published._id }, query, headers: {} })

let res = fakeRes()
await playerHandler(req({}), res)
assert.strictEqual(res.code, 200)
assert.ok(res.body.includes('id="reactShowcaseApp"'))
assert.ok(!res.body.includes('</script><script>alert'), '</script> in a name must stay escaped')
assert.ok(!res.body.includes('SECRET_USER'), 'userId must not ship')
assert.ok(!res.body.includes(DRAFT), 'draft demos must not ship')

res = fakeRes()
await playerHandler(req({ embed: '1' }), res)
assert.strictEqual(res.code, 403, 'embed=1 needs embed.enabled')

published.embed = { enabled: true, allowedDomains: ['acme.com'], showBranding: true }
res = fakeRes()
await playerHandler(req({ embed: '1', host: 'https://acme.com' }), res)
assert.ok(res.headers['Content-Security-Policy'].includes('frame-ancestors') && res.headers['Content-Security-Policy'].includes('https://acme.com'))

logger.info('showcase.check.js: all good', { eventName: 'SHOWCASE_CHECK_JS_ALL_GOOD' })
