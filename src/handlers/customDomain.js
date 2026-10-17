import axios from 'axios'
import ENV from '../envServer.js'
import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import WorkspaceTypes from '../constants/WorkspaceTypes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'

// GET    /workspaces/:workspaceId/custom-domain          status (members)
// PUT    /workspaces/:workspaceId/custom-domain          { hostname } (admin, Growth) -> Cloudflare custom hostname
// POST   /workspaces/:workspaceId/custom-domain/verify   pending -> active once Cloudflare has the cert
// DELETE /workspaces/:workspaceId/custom-domain
// Customers CNAME their subdomain to CUSTOM_DOMAIN_TARGET; Cloudflare for SaaS issues TLS. Routing: middlewares/customDomain.js

const HOSTNAME_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.){2,}[a-z]{2,63}$/

const cloudflare = (method, path, data) => axios({
    method,
    url: `https://api.cloudflare.com/client/v4/zones/${ENV.CLOUDFLARE_ZONE_ID}/custom_hostnames${path}`,
    headers: { Authorization: `Bearer ${ENV.CLOUDFLARE_API_TOKEN}` },
    data,
    timeout: 15000
}).then(res => res.data.result)

const cloudflareMessage = error => {
    const errors = error.response && error.response.data && error.response.data.errors
    return (errors && errors[0] && errors[0].message) || error.message
}

// ponytail: "2+ dots" stands in for "is a subdomain"; acme.co.uk slips through and just fails at the CNAME step
export function isValidCustomHostname(hostname) {
    const blocked = ['livedemo.ai', ENV.URL_COMMON_DOMAIN].filter(Boolean)
    return HOSTNAME_RE.test(hostname) && !blocked.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
}

async function load(req, { admin = true } = {}) {
    const Models = req.mongo.Models
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, req.params.workspaceId)
    const workspace = await Models.Workspace.findById(req.params.workspaceId).select('type adminUser customDomain').lean()
    if (!workspace) httpError(ResponseCodes['404_NOT_FOUND'], 'Workspace not found')
    const isAdmin = String(workspace.adminUser) === String(authUser._id)
    if (admin && !isAdmin) httpError(ResponseCodes['403_FORBIDDEN'], 'Only the workspace admin can manage the custom domain')
    if (admin && workspace.type !== WorkspaceTypes.GROWTH) httpError(ResponseCodes['403_FORBIDDEN'], 'Custom domains are available on the Growth plan')
    if (admin && !(ENV.CLOUDFLARE_API_TOKEN && ENV.CLOUDFLARE_ZONE_ID && ENV.CUSTOM_DOMAIN_TARGET)) {

        httpError(ResponseCodes['503_SERVICE_UNAVAILABLE'], 'Custom domains are not configured on this server')
    }
    return { Models, workspace, isAdmin }
}

const view = (workspace, isAdmin) => ({
    eligible: workspace.type === WorkspaceTypes.GROWTH,
    isAdmin,
    target: ENV.CUSTOM_DOMAIN_TARGET,
    customDomain: workspace.customDomain && workspace.customDomain.hostname
        ? {
            hostname: workspace.customDomain.hostname,
            status: workspace.customDomain.status,
            lastError: workspace.customDomain.lastError || ''
        }
        : null
})

const reload = (Models, workspaceId) => Models.Workspace.findById(workspaceId).select('type adminUser customDomain').lean()

const wrap = fn => (req, res) => {
    res.set('Cache-Control', 'no-store')
    return fn(req, res).catch(error => sendError(res, error))
}

const get = wrap(async (req, res) => {
    const { workspace, isAdmin } = await load(req, { admin: false })
    sendJson(res, view(workspace, isAdmin))
})

const put = wrap(async (req, res) => {
    const { Models, workspace } = await load(req)
    const hostname = String((req.body && req.body.hostname) || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!isValidCustomHostname(hostname)) httpError(ResponseCodes['400_BAD_REQUEST'], 'Use a subdomain you own, like demos.acme.com')
    if (await Models.Workspace.exists({ _id: { $ne: workspace._id }, 'customDomain.hostname': hostname })) {

        httpError(ResponseCodes['409_CONFLICT'], 'This domain is already used by another workspace')
    }

    const created = await cloudflare('post', '', {
        hostname,
        ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } }
    }).catch(error => httpError(ResponseCodes['400_BAD_REQUEST'], `Cloudflare: ${cloudflareMessage(error)}`))

    const old = workspace.customDomain
    if (old && old.cfHostnameId) await cloudflare('delete', `/${old.cfHostnameId}`).catch(error => console.log('[customDomain] delete old', cloudflareMessage(error)))

    await Models.Workspace.updateOne({ _id: workspace._id }, {
        $set: {
            customDomain: {
                hostname,
                status: 'pending',
                cfHostnameId: created.id,
                lastError: ''
            }
        }
    })
    sendJson(res, view(await reload(Models, workspace._id), true))
})

const verify = wrap(async (req, res) => {
    const { Models, workspace } = await load(req)
    const domain = workspace.customDomain
    if (!domain || !domain.cfHostnameId) httpError(ResponseCodes['400_BAD_REQUEST'], 'Add a domain first')

    const result = await cloudflare('get', `/${domain.cfHostnameId}`)
        .catch(error => httpError(ResponseCodes['400_BAD_REQUEST'], `Cloudflare: ${cloudflareMessage(error)}`))
    const sslStatus = result.ssl && result.ssl.status
    const active = result.status === 'active' && sslStatus === 'active'
    const lastError = active
        ? ''
        : `Waiting for DNS / certificate (hostname: ${result.status}, certificate: ${sslStatus || 'pending'}). Check the CNAME record and try again in a few minutes.`

    await Models.Workspace.updateOne({ _id: workspace._id }, {
        $set: {
            'customDomain.status': active ? 'active' : 'pending',
            'customDomain.lastError': lastError
        }
    })
    sendJson(res, view(await reload(Models, workspace._id), true))
})

const remove = wrap(async (req, res) => {
    const { Models, workspace } = await load(req)
    const domain = workspace.customDomain
    if (domain && domain.cfHostnameId) {

        await cloudflare('delete', `/${domain.cfHostnameId}`).catch(error => {

            if (!error.response || error.response.status !== 404) httpError(ResponseCodes['400_BAD_REQUEST'], `Cloudflare: ${cloudflareMessage(error)}`)
        })
    }
    await Models.Workspace.updateOne({ _id: workspace._id }, { $unset: { customDomain: 1 } })
    sendJson(res, view(await reload(Models, workspace._id), true))
})

export default {
    get,
    put,
    verify,
    remove
}
