import crypto from 'crypto'
import AuthTokenStatuses from '../constants/AuthTokenStatuses.js'
import AuthTokenTypes from '../constants/AuthTokenTypes.js'
import { normalizeSubscriptions } from './subscriptionHelpers.js'

// Long-lived API keys (ld_live_…) and OAuth access tokens (ld_oat_…) are stored as a SHA-256 hash in `token`
export const API_TOKEN_RE = /^ld_(live|oat)_[A-Za-z0-9]{20,}$/
export const hashToken = token => crypto.createHash('sha256').update(String(token)).digest('hex')

export function getUserByAccessToken(token, UserModel, AuthToken) {
    const isApiToken = API_TOKEN_RE.test(String(token || ''))
    let userDataPromise = AuthToken.findOne({
        token: isApiToken ? hashToken(token) : token,
        status: AuthTokenStatuses.ACTIVE,
        // Reset tokens only work on POST /users/changePassword, never as a login session
        type: { $ne: AuthTokenTypes.AuthToken_UserChangePassword },
        expiresAt: { $not: { $lte: new Date() } }
    }).lean()
        .then(authToken => {
            if (!authToken) {
                throw new Error('No user found by the userId from the access token')
            }

            if (isApiToken) {

                AuthToken.updateOne({ _id: authToken._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {})
            }

            return authToken
        })


    return userDataPromise
        .then((authTokenDoc) => {

            return UserModel.findOne({ _id: authTokenDoc.userId })
                .populate('workspaceMembers subscriptions workspaces', '-slackAccessTokens')
                .lean()
                .then(userData => {
                    if (!userData) {
                        throw new Error('No user found by the userId from the access token')
                    }

                    const user = JSON.parse(JSON.stringify(userData))
                    if (user.subscriptions) {
                      user.subscriptions = normalizeSubscriptions(user.subscriptions)
                    }
                    return user
                })
        })
}

export function getUserAndTokenByInstanceId(instanceId, UserModel, AuthToken) {
    let userAndTokenPromise = AuthToken.findOne({ status: AuthTokenStatuses.ACTIVE, authorizedInstances: { $in: [instanceId] } }).lean()
        .then((authTokenDoc) => {
            if (!authTokenDoc) {
                throw new Error('No token found by the instanceId')
            }

            return UserModel.findOne({ _id: authTokenDoc.userId })
                .populate('workspaceMembers subscriptions workspaces', '-slackAccessTokens')
                .lean()
                .then(userData => {
                    if (!userData) {
                        throw new Error('No user found by the userId from the access token')
                    }

                    const user = JSON.parse(JSON.stringify(userData))
                    if (user.subscriptions) {
                      user.subscriptions = normalizeSubscriptions(user.subscriptions)
                    }
                    return {
                        userData: user,
                        authToken: JSON.parse(JSON.stringify(authTokenDoc))
                    }
                })
        })

    return userAndTokenPromise
        .then(({ userData, authToken }) => {
            return {
                userData: userData,
                authToken: authToken
            }
        })
}
