import crypto from 'crypto'
import { SAML } from '@node-saml/node-saml'
import ENV from '../envServer.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import WorkspaceTypes from '../constants/WorkspaceTypes.js'
import { CORS_HEADERS } from './agent/http.js'

// SAML SSO per workspace (Growth). We are the SP; the IdP is the customer's Okta / Entra / Google Workspace.

const api = () => ENV.STORIES_API.replace(/\/$/, '')

export const emailDomain = email => String(email || '').trim().toLowerCase().split('@')[1] || ''

export function spValues(workspaceId) {
    return {
        entityId: `${api()}/sso/${workspaceId}/metadata`,
        acsUrl: `${api()}/sso/${workspaceId}/acs`,
        metadataUrl: `${api()}/sso/${workspaceId}/metadata`,
        loginUrl: `${api()}/sso/${workspaceId}/login`
    }
}

// Accepts PEM or bare base64; returns bare base64 (what node-saml wants) or '' when it isn't an X.509 cert
export function normalizeCert(input) {
    const body = String(input || '').replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '')
    if (!body) return ''
    try {

        new crypto.X509Certificate(`-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`)
        return body
    } catch {

        return ''
    }
}

// node-saml InResponseTo cache in Mongo so it works across pods (SamlRequest has a 10 min TTL)
const mongoCache = Models => ({
    saveAsync: (key, value) => Models.SamlRequest.create({ key, value })
        .then(doc => ({ value, createdAt: doc.createdAt.getTime() })),
    getAsync: key => Models.SamlRequest.findOne({ key }).lean().then(doc => (doc ? doc.value : null)),
    removeAsync: key => Models.SamlRequest.findOneAndDelete({ key }).lean().then(doc => (doc ? doc.value : null))
})

export function samlFor(Models, workspace) {
    const sp = spValues(workspace._id)
    return new SAML({
        callbackUrl: sp.acsUrl,
        entryPoint: workspace.sso.idpSsoUrl,
        issuer: sp.entityId,
        audience: sp.entityId,
        idpIssuer: workspace.sso.idpEntityId || undefined,
        idpCert: workspace.sso.idpCert,
        wantAssertionsSigned: true,
        wantAuthnResponseSigned: false,
        acceptedClockSkewMs: 5000,
        // ponytail: SP-initiated only (IdP tiles fail); 'ifPresent' would allow them at the cost of replay protection
        validateInResponseTo: 'always',
        requestIdExpirationPeriodMs: 10 * 60 * 1000,
        cacheProvider: mongoCache(Models),
        identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        disableRequestedAuthnContext: true
    })
}

export function profileEmail(profile) {
    const candidates = [
        profile.email,
        profile.mail,
        profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'],
        profile.nameID
    ]
    const email = candidates.find(value => typeof value === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value))
    return email ? email.trim().toLowerCase() : ''
}

// Without the domain check an IdP admin could sign in as anyone on any domain
export function ssoEmail(profile, workspace) {
    const email = profileEmail(profile || {})
    if (!email || !(workspace.sso.domains || []).includes(emailDomain(email))) {

        throw new Error('Your email domain is not verified for this workspace')
    }
    return email
}

export function profileName(profile, email) {
    const first = profile.firstName || profile.givenName || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'] || ''
    const last = profile.lastName || profile.surname || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname'] || ''
    return String(profile.displayName || `${first} ${last}`).trim() || email.split('@')[0]
}

export function findSsoWorkspace(Models, email) {
    const domain = emailDomain(email)
    if (!domain) return Promise.resolve(null)
    return Models.Workspace.findOne({ 'sso.domains': domain, 'sso.enabled': true, type: WorkspaceTypes.GROWTH })
        .select('_id adminUser sso')
        .lean()
}

// Every non-SSO login / signup path calls this. The workspace admin keeps password + Google login (break-glass).
export function assertNotSsoEnforced(Models, email, userId) {
    return findSsoWorkspace(Models, email).then(workspace => {
        if (!workspace || !workspace.sso.enforced) return
        if (userId && String(workspace.adminUser) === String(userId)) return

        const redirectUrl = spValues(workspace._id).loginUrl
        const error = new Error('SSO required')
        error.ssoRedirectUrl = redirectUrl
        error.resultResponse = {
            statusCode: ResponseCodes['403_FORBIDDEN'],
            headers: CORS_HEADERS,
            body: JSON.stringify({
                sso: true,
                redirectUrl,
                message: 'Your organization requires single sign-on'
            })
        }
        throw error
    })
}
