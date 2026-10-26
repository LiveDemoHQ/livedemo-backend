import crypto from 'crypto'
import dns from 'dns'
import LambdaRateLimiter from 'lambda-rate-limiter'
import ENV from '../envServer.js'
import helpers from '../helpers/livedemoHelpers.js'
import authUtils from '../helpers/authUtils.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import WorkspaceTypes from '../constants/WorkspaceTypes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import { syncSignupSubscriber } from '../helpers/sequenzy/sequenzyClient.js'
import {

    findSsoWorkspace,
    normalizeCert,
    profileName,
    samlFor,
    spValues,
    ssoEmail
} from '../helpers/sso.js'
import logger from '../helpers/logger.js'

// Settings (workspace admin, Growth):
//   GET    /workspaces/:workspaceId/sso                     config + SP values to paste into the IdP
//   PUT    /workspaces/:workspaceId/sso                     { idpEntityId, idpSsoUrl, idpCert, enabled, enforced }
//   POST   /workspaces/:workspaceId/sso/domains             { domain } -> TXT record to add
//   POST   /workspaces/:workspaceId/sso/domains/verify      checks the TXT record
//   DELETE /workspaces/:workspaceId/sso/domains/:domain
// Public:
//   GET  /sso/:workspaceId/metadata   SP metadata XML
//   POST /sso/discover                { email } -> { redirectUrl } | {}
//   GET  /sso/:workspaceId/login      302 to the IdP
//   POST /sso/:workspaceId/acs        IdP posts the SAMLResponse here

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const discoverLimiter = LambdaRateLimiter({ interval: 60000, uniqueTokenPerInterval: 5000 })

async function load(req, { admin = true } = {}) {
    const Models = req.mongo.Models
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, req.params.workspaceId)
    const workspace = await Models.Workspace.findById(req.params.workspaceId).select('type adminUser sso').lean()
    if (!workspace) httpError(ResponseCodes['404_NOT_FOUND'], 'Workspace not found')
    const isAdmin = String(workspace.adminUser) === String(authUser._id)
    if (admin && !isAdmin) httpError(ResponseCodes['403_FORBIDDEN'], 'Only the workspace admin can manage SSO')
    if (admin && workspace.type !== WorkspaceTypes.GROWTH) httpError(ResponseCodes['403_FORBIDDEN'], 'SSO is available on the Growth plan')
    return { Models, workspace, isAdmin }
}

const view = (workspace, isAdmin) => {
    const sso = workspace.sso || {}
    return {
        eligible: workspace.type === WorkspaceTypes.GROWTH,
        isAdmin,
        enabled: Boolean(sso.enabled),
        enforced: Boolean(sso.enforced),
        domains: sso.domains || [],
        pendingDomain: sso.pendingDomain && sso.pendingDomain.name
            ? { name: sso.pendingDomain.name, txtRecord: `livedemo-verification=${sso.pendingDomain.token}` }
            : null,
        idpEntityId: sso.idpEntityId || '',
        idpSsoUrl: sso.idpSsoUrl || '',
        idpCert: sso.idpCert || '',
        tested: Boolean(sso.lastLoginAt),
        sp: spValues(workspace._id)
    }
}

const reload = (Models, workspaceId) => Models.Workspace.findById(workspaceId).select('type adminUser sso').lean()

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
    const body = req.body || {}
    const sso = workspace.sso || {}

    const idpSsoUrl = String(body.idpSsoUrl ?? sso.idpSsoUrl ?? '').trim()
    const idpCert = body.idpCert === undefined ? (sso.idpCert || '') : normalizeCert(body.idpCert)
    const idpEntityId = String(body.idpEntityId ?? sso.idpEntityId ?? '').trim().slice(0, 500)
    if (idpSsoUrl && !/^https:\/\/[^\s]+$/.test(idpSsoUrl)) httpError(ResponseCodes['400_BAD_REQUEST'], 'The IdP SSO URL must start with https://')
    if (body.idpCert && !idpCert) httpError(ResponseCodes['400_BAD_REQUEST'], 'That is not a valid X.509 certificate')

    const idpChanged = idpSsoUrl !== (sso.idpSsoUrl || '') || idpCert !== (sso.idpCert || '')
    const enabled = Boolean(body.enabled ?? sso.enabled)
    const enforced = !idpChanged && Boolean(body.enforced ?? sso.enforced)
    if (enabled && (!idpSsoUrl || !idpCert)) httpError(ResponseCodes['400_BAD_REQUEST'], 'Add the IdP SSO URL and certificate first')
    if (enabled && !(sso.domains || []).length) httpError(ResponseCodes['400_BAD_REQUEST'], 'Verify at least one email domain first')
    if (enforced && (!enabled || !sso.lastLoginAt)) {

        httpError(ResponseCodes['400_BAD_REQUEST'], 'Sign in once with "Test login" before enforcing SSO')
    }

    await Models.Workspace.updateOne({ _id: workspace._id }, {
        $set: {
            'sso.idpSsoUrl': idpSsoUrl,
            'sso.idpCert': idpCert,
            'sso.idpEntityId': idpEntityId,
            'sso.enabled': enabled,
            'sso.enforced': enforced,
            ...(idpChanged ? { 'sso.lastLoginAt': null } : {})
        }
    })
    sendJson(res, view(await reload(Models, workspace._id), true))
})

const addDomain = wrap(async (req, res) => {
    const { Models, workspace } = await load(req)
    const domain = String((req.body && req.body.domain) || '').trim().toLowerCase().replace(/^@/, '')
    if (!DOMAIN_RE.test(domain)) httpError(ResponseCodes['400_BAD_REQUEST'], 'Enter a domain like acme.com')
    if (await Models.Workspace.exists({ 'sso.domains': domain })) {

        httpError(ResponseCodes['409_CONFLICT'], 'This domain is already verified by a workspace')
    }

    const pendingDomain = { name: domain, token: crypto.randomBytes(16).toString('hex') }
    await Models.Workspace.updateOne({ _id: workspace._id }, { $set: { 'sso.pendingDomain': pendingDomain } })
    sendJson(res, view(await reload(Models, workspace._id), true))
})

const verifyDomain = wrap(async (req, res) => {
    const { Models, workspace } = await load(req)
    const pending = workspace.sso && workspace.sso.pendingDomain
    if (!pending || !pending.name) httpError(ResponseCodes['400_BAD_REQUEST'], 'Add a domain first')

    const records = await dns.promises.resolveTxt(pending.name).catch(() => [])
    if (!records.map(parts => parts.join('')).includes(`livedemo-verification=${pending.token}`)) {

        httpError(ResponseCodes['400_BAD_REQUEST'], `TXT record not found on ${pending.name} yet. DNS changes can take a few minutes.`)
    }

    await Models.Workspace.updateOne(
        { _id: workspace._id },
        { $addToSet: { 'sso.domains': pending.name }, $unset: { 'sso.pendingDomain': 1 } }
    ).catch(error => {

        if (error.code === 11000) httpError(ResponseCodes['409_CONFLICT'], 'This domain is already verified by a workspace')
        throw error
    })
    sendJson(res, view(await reload(Models, workspace._id), true))
})

const removeDomain = wrap(async (req, res) => {
    const { Models, workspace } = await load(req)
    const domains = ((workspace.sso && workspace.sso.domains) || []).filter(domain => domain !== req.params.domain)
    await Models.Workspace.updateOne({ _id: workspace._id }, {
        $pull: { 'sso.domains': req.params.domain },
        ...(domains.length ? {} : { $set: { 'sso.enabled': false, 'sso.enforced': false } })
    })
    sendJson(res, view(await reload(Models, workspace._id), true))
})

function loadSsoWorkspace(Models, workspaceId) {
    return Models.Workspace.findOne({ _id: workspaceId, 'sso.enabled': true, type: WorkspaceTypes.GROWTH })
        .select('_id sso')
        .lean()
        .then(workspace => {
            if (!workspace) throw new Error('SSO is not enabled for this workspace')
            return workspace
        })
}

const isObjectId = id => /^[a-f0-9]{24}$/.test(String(id))

const metadata = (req, res) => {
    if (!isObjectId(req.params.workspaceId)) return res.status(404).send('Not found')
    return req.mongo.Models.Workspace.findById(req.params.workspaceId).select('_id sso').lean()
        .then(workspace => {
            if (!workspace) return res.status(404).send('Not found')
            const xml = samlFor(req.mongo.Models, { ...workspace, sso: { ...workspace.sso, idpCert: workspace.sso?.idpCert || 'unset' } })
                .generateServiceProviderMetadata(null, null)
            res.type('application/xml').send(xml)
        })
        .catch(error => {

            logger.error(error, { eventName: 'SSO_FAILED' })
            res.status(500).send('')
        })
}

const discover = (req, res) => {
    const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown'
    return discoverLimiter.check(10, clientIp)
        .then(() => findSsoWorkspace(req.mongo.Models, req.body && req.body.email), () => {
            httpError(ResponseCodes['429_TOO_MANY_REQUESTS'], 'Too many requests')
        })
        .then(workspace => sendJson(res, workspace ? { redirectUrl: spValues(workspace._id).loginUrl } : {}))
        .catch(error => sendError(res, error))
}

const loginFailed = (res, message) => res.redirect(`${ENV.SERVER_URL}/login?ssoError=${encodeURIComponent(message)}`)

const login = (req, res) => {
    const { Models } = req.mongo
    if (!isObjectId(req.params.workspaceId)) return loginFailed(res, 'Unknown SSO workspace')
    return loadSsoWorkspace(Models, req.params.workspaceId)
        .then(workspace => samlFor(Models, workspace).getAuthorizeUrlAsync('', undefined, {}))
        .then(url => res.redirect(url))
        .catch(error => {

            logger.error('[sso] login failed', { eventName: 'LOGIN_FAILED', err: error.message })
            loginFailed(res, error.message)
        })
}

const acs = (req, res) => {
    const { Models } = req.mongo
    if (!isObjectId(req.params.workspaceId)) return loginFailed(res, 'Unknown SSO workspace')
    return loadSsoWorkspace(Models, req.params.workspaceId)
        .then(async workspace => {
            const { profile } = await samlFor(Models, workspace).validatePostResponseAsync(req.body || {})
            const email = ssoEmail(profile, workspace)

            let user = await Models.User.findOne({ email }).collation({ locale: 'en', strength: 2 })
            if (!user) {

                user = await new Models.User({
                    name: profileName(profile, email),
                    email,
                    password: '',
                    emailVerified: true
                }).save()
                void syncSignupSubscriber(user.toObject(), Models, { source: 'sso' }).catch(() => {})
            }

            await Models.User.updateOne({ _id: user._id }, { $addToSet: { workspaces: workspace._id }, $set: { emailVerified: true } })
            await Models.Workspace.updateOne(
                { _id: workspace._id },
                { $addToSet: { users: user._id }, $set: { 'sso.lastLoginAt': new Date() } }
            )
            const authToken = await authUtils.createTokenForUser(user, Models.AuthToken)
            res.redirect(`${ENV.SERVER_URL}/auth/?page=${encodeURIComponent('/')}&token=${authToken.token}`)
        })
        .catch(error => {

            logger.error('[sso] acs failed', { eventName: 'ACS_FAILED', err: error.message })
            loginFailed(res, /domain/.test(error.message) ? error.message : 'Single sign-on failed. Ask your admin to check the SSO setup.')
        })
}

export default {
    get,
    put,
    addDomain,
    verifyDomain,
    removeDomain,
    metadata,
    discover,
    login,
    acs
}
