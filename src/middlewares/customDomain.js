import net from 'net'
import ENV from '../envServer.js'
import { parseOEmbedUrl } from '../helpers/agent/parseOEmbedUrl.js'

// Customer domains (Cloudflare for SaaS, CNAME -> CUSTOM_DOMAIN_TARGET) reach this API with their own Host.
// They may only see the public viewer pages of their own workspace; everything else is 404, so our API
// surface never shows up under a customer's brand. See handlers/customDomain.js.

const hostOf = url => {
    try {

        return new URL(url).hostname.toLowerCase()
    } catch {

        return ''
    }
}

export function isOwnHost(host) {
    const own = [ENV.STORIES_API, ENV.SERVER_URL, ENV.STORY_API, ENV.CUSTOM_DOMAIN_TARGET && `https://${ENV.CUSTOM_DOMAIN_TARGET}`]
        .map(hostOf)
        .filter(Boolean)
    const common = String(ENV.URL_COMMON_DOMAIN || '').toLowerCase()
    return !host
        || own.includes(host)
        || !host.includes('.')
        || net.isIP(host) !== 0
        || /\.(local|internal|svc|localhost)$/.test(host)
        || Boolean(common && (host === common || host.endsWith(`.${common}`)))
}

export function activeWorkspaceForHost(Models, host) {
    return Models.Workspace.findOne({ 'customDomain.hostname': host, 'customDomain.status': 'active' }).select('_id').lean()
}

export function rewriteForWorkspace(path, workspaceId) {
    const story = path.match(/^\/livedemos\/([a-f0-9]{24})(?:\/links\/([a-f0-9]{24}))?\/?$/)
    if (story) return `/workspaces/${workspaceId}/stories/${story[1]}/preview?embed${story[2] ? `&link=${story[2]}` : ''}`
    const agent = path.match(/^\/agents\/([a-f0-9]{24})(?:\/links\/[a-f0-9]{24})?\/?$/)
    if (agent) return `/agents/${agent[1]}/player`
    const showcase = path.match(/^\/showcases\/([a-f0-9]{24})\/?$/)
    if (showcase) return `/showcases/${showcase[1]}/player`
    return null
}

// oEmbed for custom-domain links: same parser, workspace pinned to the domain owner
export function parseCustomDomainUrl(Models, url) {
    const host = hostOf(url)
    if (isOwnHost(host)) return Promise.resolve(null)
    return activeWorkspaceForHost(Models, host).then(workspace => {
        const parsed = workspace && parseOEmbedUrl(url, [new URL(url).origin])
        return parsed ? { ...parsed, workspaceId: String(workspace._id) } : null
    })
}

export default function customDomain(req, res, next) {
    const host = String(req.hostname || '').toLowerCase()
    if (isOwnHost(host)) return next()
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(404).send('Not found')

    return activeWorkspaceForHost(req.mongo.Models, host)
        .then(workspace => {
            const url = workspace && rewriteForWorkspace(req.path, workspace._id)
            if (!url) return res.status(404).send('Not found')
            const query = new URLSearchParams(req.query).toString()
            req.url = query ? `${url}${url.includes('?') ? '&' : '?'}${query}` : url
            req.customDomainWorkspaceId = String(workspace._id)
            next()
        })
        .catch(next)
}
