import crypto from 'crypto'
import ENV from '../envServer.js'
import helpers from '../helpers/livedemoHelpers.js'
import AuthTokenStatuses from '../constants/AuthTokenStatuses.js'
import AuthTokenTypes from '../constants/AuthTokenTypes.js'
import { CORS_HEADERS } from '../helpers/agent/http.js'
import { hashToken } from '../helpers/authHelpers.js'
import { newApiToken } from './apiKeys.js'

// OAuth 2.1 authorization server for the MCP connectors (Claude.ai, ChatGPT, ...):
//   GET  /.well-known/oauth-authorization-server   RFC 8414 metadata
//   POST /oauth/register                           RFC 7591 dynamic client registration (public clients)
//   GET  /oauth/authorize                          validates, then sends the user to the SPA consent page
//   POST /oauth/authorize/decision                 SPA (signed-in session) approves/denies -> redirect URL
//   POST /oauth/token                              authorization_code (PKCE S256) and refresh_token (rotating)
// Access tokens are AuthToken_ApiKey docs (ld_oat_, hashed), so every existing route accepts them as-is.

const ACCESS_TTL_S = 3600
const CODE_TTL_MS = 10 * 60 * 1000
const SCOPE = 'mcp'

const issuer = () => ENV.STORIES_API.replace(/\/$/, '')

function json(res, status, body) {
    res.set(CORS_HEADERS)
    res.set('Cache-Control', 'no-store')
    res.status(status).json(body)
}

const oauthError = (res, error, description, status = 400) => json(res, status, {
    error,
    error_description: description
})

// https anywhere, or http only on loopback (native / CLI clients)
export function isValidRedirectUri(uri) {
    try {

        const url = new URL(uri)
        if (url.hash) return false
        if (url.protocol === 'https:') return true
        return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    } catch {

        return false
    }
}

export function pkceMatches(verifier, challenge) {
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(String(verifier || ''))) return false
    return crypto.createHash('sha256').update(verifier).digest('base64url') === challenge
}

const withParams = (uri, params) => {
    const url = new URL(uri)
    Object.entries(params).forEach(([key, value]) => value && url.searchParams.set(key, value))
    return url.toString()
}

const metadata = (req, res) => json(res, 200, {
    issuer: issuer(),
    authorization_endpoint: `${issuer()}/oauth/authorize`,
    token_endpoint: `${issuer()}/oauth/token`,
    registration_endpoint: `${issuer()}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE]
})

const register = (req, res) => {
    const body = req.body || {}
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : []
    if (!redirectUris.length || redirectUris.length > 10 || !redirectUris.every(isValidRedirectUri)) {

        return oauthError(res, 'invalid_redirect_uri', 'redirect_uris must be https (or http on localhost)')
    }

    const client = {
        clientId: `ldc_${crypto.randomBytes(16).toString('hex')}`,
        clientName: String(body.client_name || 'MCP client').slice(0, 80),
        redirectUris
    }
    return req.mongo.Models.OAuthClient.create(client)
        .then(doc => json(res, 201, {
            client_id: doc.clientId,
            client_id_issued_at: Math.floor(doc.createdAt.getTime() / 1000),
            client_name: doc.clientName,
            redirect_uris: doc.redirectUris,
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code']
        }))
        .catch(error => {

            console.log(error)
            oauthError(res, 'server_error', 'Could not register client', 500)
        })
}

// Shared by /authorize and /decision: never redirect anywhere before client_id + redirect_uri check out.
function checkAuthorizeParams(Models, params) {
    return Models.OAuthClient.findOne({ clientId: String(params.client_id || '') }).lean()
        .then(client => {
            if (!client || !client.redirectUris.includes(params.redirect_uri)) return { fatal: 'Unknown client or redirect_uri' }
            if (params.response_type && params.response_type !== 'code') return { client, error: 'unsupported_response_type' }
            if (!params.code_challenge || params.code_challenge_method !== 'S256') return { client, error: 'invalid_request' }
            if (params.resource && ENV.MCP_URL && params.resource.replace(/\/$/, '') !== ENV.MCP_URL.replace(/\/$/, '')) {

                return { client, error: 'invalid_target' }
            }
            return { client }
        })
}

const authorize = (req, res) => {
    const params = req.query
    return checkAuthorizeParams(req.mongo.Models, params)
        .then(({ client, fatal, error }) => {
            if (fatal) return res.status(400).send(fatal)
            if (error) return res.redirect(withParams(params.redirect_uri, { error, state: params.state }))
            res.redirect(withParams(`${ENV.SERVER_URL}/oauth/consent`, {
                client_id: client.clientId,
                client_name: client.clientName,
                redirect_uri: params.redirect_uri,
                code_challenge: params.code_challenge,
                code_challenge_method: 'S256',
                state: params.state,
                resource: params.resource
            }))
        })
        .catch(error => {

            console.log(error)
            res.status(500).send('Authorization failed')
        })
}

const decision = (req, res) => {
    const { Models } = req.mongo
    const params = req.body || {}
    return checkAuthorizeParams(Models, params)
        .then(({ fatal, error }) => {
            if (fatal) return oauthError(res, 'invalid_client', fatal)
            if (error) return json(res, 200, { redirectUrl: withParams(params.redirect_uri, { error, state: params.state }) })
            if (!params.approve) {

                return json(res, 200, { redirectUrl: withParams(params.redirect_uri, { error: 'access_denied', state: params.state }) })
            }

            return helpers.authReq(req, Models)
                .then(({ authUser }) => {
                    const code = crypto.randomBytes(32).toString('base64url')
                    return Models.OAuthCode.create({
                        codeHash: hashToken(code),
                        clientId: params.client_id,
                        userId: authUser._id,
                        redirectUri: params.redirect_uri,
                        codeChallenge: params.code_challenge,
                        resource: params.resource || '',
                        expiresAt: new Date(Date.now() + CODE_TTL_MS)
                    }).then(() => json(res, 200, { redirectUrl: withParams(params.redirect_uri, { code, state: params.state }) }))
                })
        })
        .catch(error => {

            console.log(error)
            if (error.resultResponse) return oauthError(res, 'access_denied', 'Sign in first', 401)
            oauthError(res, 'server_error', 'Authorization failed', 500)
        })
}

function issueTokens(Models, { userId, clientId, existing }) {
    const accessToken = newApiToken('oat')
    const refreshToken = `ld_ort_${crypto.randomBytes(32).toString('base64url')}`
    const fields = {
        token: hashToken(accessToken),
        refreshTokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000)
    }
    const save = existing
        ? Models.AuthToken_ApiKey.updateOne({ _id: existing._id }, { $set: fields })
        : Models.OAuthClient.findOne({ clientId }).lean().then(client => Models.AuthToken_ApiKey.create({
            ...fields,
            type: AuthTokenTypes.AuthToken_ApiKey,
            status: AuthTokenStatuses.ACTIVE,
            userId,
            clientId: 'oauth',
            oauthClientId: clientId,
            name: client ? client.clientName : 'MCP client',
            prefix: 'OAuth'
        }))
    return save.then(() => ({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TTL_S,
        refresh_token: refreshToken,
        scope: SCOPE
    }))
}

const token = (req, res) => {
    const { Models } = req.mongo
    const body = req.body || {}

    if (body.grant_type === 'authorization_code') {

        return Models.OAuthCode.findOneAndDelete({ codeHash: hashToken(String(body.code || '')) }).lean()
            .then(code => {
                if (!code || code.expiresAt < new Date() || code.clientId !== body.client_id || code.redirectUri !== body.redirect_uri) {

                    return oauthError(res, 'invalid_grant', 'Invalid or expired code')
                }
                if (!pkceMatches(body.code_verifier, code.codeChallenge)) return oauthError(res, 'invalid_grant', 'PKCE check failed')
                return issueTokens(Models, { userId: code.userId, clientId: code.clientId }).then(tokens => json(res, 200, tokens))
            })
            .catch(error => {

                console.log(error)
                oauthError(res, 'server_error', 'Token exchange failed', 500)
            })
    }

    if (body.grant_type === 'refresh_token') {

        return Models.AuthToken_ApiKey.findOne({
            refreshTokenHash: hashToken(String(body.refresh_token || '')),
            status: AuthTokenStatuses.ACTIVE
        }).lean()
            .then(existing => {
                if (!existing || (body.client_id && existing.oauthClientId !== body.client_id)) {

                    return oauthError(res, 'invalid_grant', 'Invalid refresh token')
                }
                return issueTokens(Models, { existing }).then(tokens => json(res, 200, tokens))
            })
            .catch(error => {

                console.log(error)
                oauthError(res, 'server_error', 'Token refresh failed', 500)
            })
    }

    return oauthError(res, 'unsupported_grant_type', 'Use authorization_code or refresh_token')
}

export default {
    metadata,
    register,
    authorize,
    decision,
    token
}
