import ENV from '../../envServer.js'
import WorkspaceTypes from '../../constants/WorkspaceTypes.js'
import { seal, open } from '../secretBox.js'

// Growth workspaces can bring their own Anam / LemonSlice API keys; billed avatar calls then use them.
// Stored encrypted on Workspace.providerKeys (select: false), bound to the workspace id. Never returned.

export const PROVIDERS = {
    anam: { label: 'Anam', defaultKey: () => ENV.ANAM_API_KEY },
    lemonslice: { label: 'LemonSlice', defaultKey: () => ENV.LEMONSLICE_API_KEY }
}

const KEY_RE = /^[\x21-\x7e]{16,256}$/
const purpose = provider => `provider-key:${provider}`

export const canUseCustomKeys = workspace => !!workspace && workspace.type === WorkspaceTypes.GROWTH

export function isValidKeyFormat(apiKey) {
    return typeof apiKey === 'string' && KEY_RE.test(apiKey)
}

export function sealKey(provider, apiKey, workspaceId) {
    return seal(apiKey, purpose(provider), String(workspaceId))
}

// Saved/updatedAt only, never the key or any part of it
export function publicKeyStatus(workspace) {
    const keys = (workspace && workspace.providerKeys) || {}
    return Object.fromEntries(Object.keys(PROVIDERS).map(provider => [
        provider,
        { saved: !!(keys[provider] && keys[provider].enc), updatedAt: (keys[provider] && keys[provider].updatedAt) || null }
    ]))
}

// ownKey: the workspace's saved key decrypted. False falls back to LiveDemo's key.
export function resolveKeyInfo(workspace, provider) {
    const entry = workspace && workspace.providerKeys && workspace.providerKeys[provider]
    if (canUseCustomKeys(workspace) && entry && entry.enc) {

        try {
            return { apiKey: open(entry.enc, purpose(provider), String(workspace._id)), ownKey: true }
        } catch (err) {
            console.log(`[providerKeys] ${provider} key for workspace ${workspace._id} could not be decrypted, using the default`)
        }
    }
    return { apiKey: PROVIDERS[provider].defaultKey(), ownKey: false }
}

export function resolveKey(workspace, provider) {
    return resolveKeyInfo(workspace, provider).apiKey
}

// The workspace's own key on Growth, else LiveDemo's
export async function workspaceApiKey(Models, workspaceId, provider) {
    const workspace = await Models.Workspace.findById(workspaceId).select('type +providerKeys').lean()
    return resolveKey(workspace, provider)
}

// true = accepted, false = rejected, null = could not check
export async function verifyKey(provider, apiKey) {
    if (provider !== 'anam') return null
    try {
        const res = await fetch('https://api.anam.ai/v1/avatars?perPage=1', { headers: { Authorization: `Bearer ${apiKey}` } })
        if (res.ok) return true
        if (res.status === 401 || res.status === 403) return false
    } catch {
        // network error: fall through
    }
    return null
}
