import crypto from 'crypto'
import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import AuthTokenStatuses from '../constants/AuthTokenStatuses.js'
import AuthTokenTypes from '../constants/AuthTokenTypes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import { hashToken } from '../helpers/authHelpers.js'

// GET    /users/api-keys          list keys + connected OAuth apps (no secrets)
// POST   /users/api-keys { name } create; the full key is returned once
// DELETE /users/api-keys/:keyId   revoke
// Keys authenticate the MCP server (and any REST call) as the user. Routes are sessionOnly (server.js).

const MAX_KEYS = 10

export function newApiToken(kind) {
    return `ld_${kind}_${crypto.randomBytes(24).toString('base64url').replace(/[^A-Za-z0-9]/g, '')}`
}

const publicKey = key => ({
    _id: key._id,
    name: key.name,
    prefix: key.prefix,
    oauth: Boolean(key.oauthClientId),
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt || null
})

async function auth(req) {
    const { Models } = req.mongo
    const { authUser } = await helpers.authReq(req, Models)
    return { Models, authUser }
}

const activeKeys = authUser => ({
    userId: authUser._id,
    status: AuthTokenStatuses.ACTIVE,
    oauthClientId: { $exists: false }
})

const wrap = fn => (req, res) => {
    res.set('Cache-Control', 'no-store')
    return fn(req, res).catch(error => sendError(res, error))
}

const list = wrap(async (req, res) => {
    const { Models, authUser } = await auth(req)
    const keys = await Models.AuthToken_ApiKey.find({ userId: authUser._id, status: AuthTokenStatuses.ACTIVE })
        .sort({ createdAt: -1 })
        .lean()
    sendJson(res, keys.map(publicKey))
})

const create = wrap(async (req, res) => {
    const { Models, authUser } = await auth(req)
    const name = String((req.body && req.body.name) || '').trim().slice(0, 60)
    if (!name) httpError(ResponseCodes['400_BAD_REQUEST'], 'Give the key a name')
    if (await Models.AuthToken_ApiKey.countDocuments(activeKeys(authUser)) >= MAX_KEYS) {

        httpError(ResponseCodes['400_BAD_REQUEST'], `Up to ${MAX_KEYS} API keys per user`)
    }

    const apiKey = newApiToken('live')
    const doc = await Models.AuthToken_ApiKey.create({
        token: hashToken(apiKey),
        type: AuthTokenTypes.AuthToken_ApiKey,
        status: AuthTokenStatuses.ACTIVE,
        userId: authUser._id,
        clientId: 'apiKey',
        name,
        prefix: `${apiKey.slice(0, 12)}…`
    })
    sendJson(res, { ...publicKey(doc.toObject()), key: apiKey })
})

const remove = wrap(async (req, res) => {
    const { Models, authUser } = await auth(req)
    const result = await Models.AuthToken_ApiKey.updateOne(
        { _id: req.params.keyId, userId: authUser._id },
        { $set: { status: AuthTokenStatuses.EXPIRED } }
    )
    if (!result.matchedCount) httpError(ResponseCodes['404_NOT_FOUND'], 'API key not found')
    sendJson(res, { _id: req.params.keyId })
})

export default {
    list,
    create,
    remove
}
