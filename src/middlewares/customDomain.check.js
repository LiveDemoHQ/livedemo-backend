// node src/middlewares/customDomain.check.js
import assert from 'assert'
import ENV from '../envServer.js'
import customDomain, { isOwnHost } from './customDomain.js'
import { isValidCustomHostname } from '../handlers/customDomain.js'

ENV.STORIES_API = 'https://api.livedemo.ai'
ENV.SERVER_URL = 'https://app.livedemo.ai'
ENV.URL_COMMON_DOMAIN = 'livedemo.ai'

const WS = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const STORY = 'cccccccccccccccccccccccc'
const LINK = 'dddddddddddddddddddddddd'
const lookups = []
const Models = {
    Workspace: {
        findOne: filter => {
            lookups.push(filter)
            const hit = filter['customDomain.hostname'] === 'demos.acme.com' ? { _id: WS } : null
            return { select: () => ({ lean: () => Promise.resolve(hit) }) }
        }
    }
}

function run(hostname, url, method = 'GET') {
    const [path, search = ''] = url.split('?')
    const req = {
        hostname,
        method,
        url,
        path,
        query: Object.fromEntries(new URLSearchParams(search)),
        mongo: { Models }
    }
    const result = { status: null, nextCalled: false, req }
    const res = {
        status: code => {
            result.status = code
            return { send: () => result }
        }
    }
    return Promise.resolve(customDomain(req, res, () => {
        result.nextCalled = true
    })).then(() => result)
}

// (a) our own hosts (and k8s probes by IP / service name) pass through untouched, no DB lookup
for (const host of ['api.livedemo.ai', 'app.livedemo.ai', 'x.livedemo.ai', 'localhost', '10.0.0.7', 'backend.default.svc']) {

    const result = await run(host, '/workspaces/x/leads')
    assert.ok(result.nextCalled && result.req.url === '/workspaces/x/leads', host)
}
assert.equal(lookups.length, 0)

// (b) story + link + agent links are rewritten with the domain owner's workspace
let result = await run('demos.acme.com', `/livedemos/${STORY}`)
assert.equal(result.req.url, `/workspaces/${WS}/stories/${STORY}/preview?embed`)
assert.equal(result.req.customDomainWorkspaceId, WS)
result = await run('demos.acme.com', `/livedemos/${STORY}/links/${LINK}?step=2`)
assert.equal(result.req.url, `/workspaces/${WS}/stories/${STORY}/preview?embed&link=${LINK}&step=2`)
result = await run('demos.acme.com', `/agents/${STORY}`)
assert.equal(result.req.url, `/agents/${STORY}/player`)

// (c) anything else on a customer domain is 404, including POSTs to public paths
assert.equal((await run('demos.acme.com', '/workspaces/x/leads')).status, 404)
assert.equal((await run('demos.acme.com', `/livedemos/${STORY}`, 'POST')).status, 404)

// (d) unknown host is 404
assert.equal((await run('evil.example.com', `/livedemos/${STORY}`)).status, 404)

assert.ok(isOwnHost('api.livedemo.ai') && !isOwnHost('demos.acme.com'))
assert.ok(isValidCustomHostname('demos.acme.com'))
assert.ok(!isValidCustomHostname('acme.com'))
assert.ok(!isValidCustomHostname('evil.livedemo.ai'))
assert.ok(!isValidCustomHostname('demos.acme.com/x'))

console.log('customDomain.check ok')
process.exit(0)
