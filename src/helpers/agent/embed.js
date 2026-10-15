import ResponseCodes from '../../constants/ResponseCodes.js'
import { httpError } from './http.js'
import { getAllowedDemos } from './validateActions.js'
import thumbnailForScreen from './thumbnailForScreen.js'

// Website embed (SDK) helpers. allowedDomains end up in a CSP header and in
// postMessage targetOrigin checks, so everything here is a trust boundary.

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const DOMAIN_RE = new RegExp(`^(?:\\*\\.)?(?:${LABEL}\\.)+[a-z]{2,63}$`)
const MAX_DOMAINS = 50

// 'https://www.Acme.com:443/pricing' -> 'www.acme.com'; '*.acme.com' stays; junk -> null
export function normalizeDomain(raw) {
    const value = String(raw || '').trim().toLowerCase()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
        .replace(/[/?#].*$/, '')
        .replace(/:\d+$/, '')
    if (value === 'localhost') return value
    return DOMAIN_RE.test(value) ? value : null
}

export function normalizeAllowedDomains(list) {
    if (!Array.isArray(list)) {
        httpError(ResponseCodes['400_BAD_REQUEST'], 'embed.allowedDomains must be an array')
    }
    const domains = []
    list.forEach((raw) => {
        const domain = normalizeDomain(raw)
        if (!domain) {
            httpError(ResponseCodes['400_BAD_REQUEST'], `Not a valid domain: ${String(raw).slice(0, 100)}`)
        }
        if (!domains.includes(domain)) domains.push(domain)
    })
    if (domains.length > MAX_DOMAINS) {
        httpError(ResponseCodes['400_BAD_REQUEST'], `Up to ${MAX_DOMAINS} allowed domains`)
    }
    return domains
}

function hostMatches(hostname, domain) {
    if (domain.startsWith('*.')) return hostname.endsWith(domain.slice(1))
    return hostname === domain
}

// Returns the normalized origin ('https://acme.com') when allowed, else null. [] = any site.
export function allowedOrigin(origin, domains = []) {
    let url
    try {
        url = new URL(String(origin || ''))
    } catch {
        return null
    }
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (domains.length && !domains.some(domain => hostMatches(url.hostname, domain))) return null
    return url.origin
}

export function frameAncestors(domains = [], appUrl = '') {
    if (!domains.length) return '*'
    const sources = domains.map(domain => (domain === 'localhost' ? 'http://localhost:*' : `https://${domain}`))
    return [appUrl, ...sources].filter(Boolean).join(' ')
}

// Plan gate: same featureFlag that unlocks watermark removal on stories
export function canRemoveBranding(user) {
    return !!(user && user.featureFlags && user.featureFlags.allowRemoveWatermark)
}

// Effective value: stored false only sticks while the workspace admin's plan allows it,
// so a downgrade brings the badge back without touching the agent.
export async function resolveShowBranding(Models, agent) {
    if (!agent.embed || agent.embed.showBranding !== false) return true
    const workspace = await Models.Workspace.findById(agent.workspaceId)
        .select('adminUser')
        .populate('adminUser', 'featureFlags')
        .lean()
    return !canRemoveBranding(workspace && workspace.adminUser)
}

export async function resolvePreviewImage(Models, agent, allowedDemos) {
    const preview = (agent.embed && agent.embed.preview) || {}
    const source = preview.source || 'demo'
    if (source === 'none') return ''
    if (source === 'custom') return preview.imageUrl || ''

    const candidates = [preview.demoId, agent.defaultDemoId, allowedDemos[0] && allowedDemos[0]._id].filter(Boolean).map(String)
    const demo = candidates.map(id => allowedDemos.find(d => String(d._id) === id)).find(Boolean)
    if (!demo) return ''
    if (demo.thumbnailImageUrl) return demo.thumbnailImageUrl

    const story = await Models.Story.findOne({ _id: demo._id })
        .select('screens')
        .populate({
            path: 'screens',
            select: '_id type imageUrl index asset',
            options: { sort: { index: 1 } }
        })
        .lean()
    return thumbnailForScreen(story && story.screens && story.screens[0])
}

// Public shape for /preview and the player: no allowedDomains, resolved image + branding
export async function publicEmbedConfig(Models, agent, allowedDemos) {
    const embed = (agent.embed && (agent.embed.toObject ? agent.embed.toObject() : agent.embed)) || {}
    const { allowedDomains, ...rest } = embed
    return {
        ...rest,
        enabled: !!embed.enabled,
        showBranding: await resolveShowBranding(Models, agent),
        preview: {
            ...(embed.preview || {}),
            resolvedImageUrl: await resolvePreviewImage(Models, agent, allowedDemos)
        }
    }
}

const ENUMS = {
    launcher: ['bubble', 'pill', 'smartbar', 'none'],
    position: ['right', 'left', 'center'],
    'pill.expand': ['hover', 'click', 'always'],
    'pill.size': ['small', 'medium', 'large'],
    'pill.icon': ['avatar', 'video', 'orb', 'aurora', 'plasma', 'pulse', 'glow', 'blue'],
    'smartbar.icon': ['orb', 'aurora', 'plasma', 'pulse', 'glow', 'blue', 'avatar'],
    'preview.source': ['demo', 'custom', 'none']
}
const BOOLS = ['enabled', 'showBranding', 'pill.requireWorkEmail', 'pill.emailOptional', 'pill.showMic', 'preview.animateCursor']
const STRINGS = {
    teaserText: 200,
    'pill.placeholder': 60,
    'smartbar.placeholder': 80
}
// [min, max] whole numbers. faceX/faceY: % shift of the avatar inside the pill circle, faceZoom: % scale
const INTS = {
    'pill.faceX': [-30, 30],
    'pill.faceY': [-30, 30],
    'pill.faceZoom': [50, 200]
}

const MAX_RULES = 20

// Per-page overrides. Pattern is a path glob ('/pricing', '/docs/*', '*'), matched client-side
export function normalizeEmbedRules(list) {
    if (!Array.isArray(list)) bad('embed.rules must be an array')
    if (list.length > MAX_RULES) bad(`Up to ${MAX_RULES} page rules`)
    return list.map((raw, i) => {
        const rule = raw && typeof raw === 'object' ? raw : {}
        const urlPattern = String(rule.urlPattern || '').trim()
        if (!urlPattern || urlPattern.length > 200 || !/^(\*|\/[^\s]*)$/.test(urlPattern)) bad(`embed.rules[${i}].urlPattern must be a path like /pricing or /docs/*`)
        const teaserText = String(rule.teaserText || '').trim()
        if (teaserText.length > 200) bad(`embed.rules[${i}].teaserText must be up to 200 characters`)
        const starterQuestions = (Array.isArray(rule.starterQuestions) ? rule.starterQuestions : [])
            .map(q => String(q || '').trim())
            .filter(Boolean)
        if (starterQuestions.length > 4 || starterQuestions.some(q => q.length > 120)) bad(`embed.rules[${i}].starterQuestions: up to 4, 120 characters each`)
        const autoOpenAfterMs = Number(rule.autoOpenAfterMs || 0)
        if (!Number.isInteger(autoOpenAfterMs) || autoOpenAfterMs < 0 || autoOpenAfterMs > 60000) bad(`embed.rules[${i}].autoOpenAfterMs must be 0-60000`)
        return {
            urlPattern,
            teaserText,
            starterQuestions,
            autoOpenAfterMs,
            hidden: rule.hidden === true
        }
    })
}

function read(obj, path) {
    return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), obj)
}

function bad(message) {
    httpError(ResponseCodes['400_BAD_REQUEST'], message)
}

// PATCH body.embed -> dotted $set keys, so a partial patch never wipes sibling settings
export async function embedPatchUpdates(Models, agent, authUser, input) {
    if (!input || typeof input !== 'object') bad('embed must be an object')
    const updates = {}

    Object.entries(ENUMS).forEach(([path, values]) => {
        const value = read(input, path)
        if (value === undefined) return
        if (!values.includes(value)) bad(`embed.${path} must be one of ${values.join(', ')}`)
        updates[`embed.${path}`] = value
    })

    BOOLS.forEach((path) => {
        const value = read(input, path)
        if (value === undefined) return
        if (typeof value !== 'boolean') bad(`embed.${path} must be a boolean`)
        updates[`embed.${path}`] = value
    })

    Object.entries(STRINGS).forEach(([path, max]) => {
        const value = read(input, path)
        if (value === undefined) return
        if (typeof value !== 'string' || value.length > max) bad(`embed.${path} must be text up to ${max} characters`)
        updates[`embed.${path}`] = value.trim()
    })

    Object.entries(INTS).forEach(([path, [min, max]]) => {
        const value = read(input, path)
        if (value === undefined) return
        if (!Number.isInteger(value) || value < min || value > max) bad(`embed.${path} must be a whole number from ${min} to ${max}`)
        updates[`embed.${path}`] = value
    })

    if (input.teaserDelayMs !== undefined) {
        const delay = Number(input.teaserDelayMs)
        if (!Number.isInteger(delay) || delay < 0 || delay > 60000) bad('embed.teaserDelayMs must be 0-60000')
        updates['embed.teaserDelayMs'] = delay
    }

    // Interpolated into the launcher's CSS
    if (input.accentColor !== undefined) {
        if (input.accentColor !== '' && !/^#[0-9a-f]{6}$/i.test(input.accentColor)) bad('embed.accentColor must be #rrggbb')
        updates['embed.accentColor'] = input.accentColor
    }
    const faceBg = read(input, 'pill.faceBg')
    if (faceBg !== undefined) {
        if (faceBg !== '' && !/^#[0-9a-f]{6}$/i.test(faceBg)) bad('embed.pill.faceBg must be #rrggbb')
        updates['embed.pill.faceBg'] = faceBg
    }

    if (input.allowedDomains !== undefined) {
        updates['embed.allowedDomains'] = normalizeAllowedDomains(input.allowedDomains)
    }

    if (input.rules !== undefined) {
        updates['embed.rules'] = normalizeEmbedRules(input.rules)
    }

    if (updates['embed.showBranding'] === false && !canRemoveBranding(authUser)) {
        httpError(ResponseCodes['403_FORBIDDEN'], 'Upgrade your plan to remove LiveDemo branding')
    }

    const demoId = read(input, 'preview.demoId')
    if (demoId !== undefined) {
        if (demoId) {
            const allowed = await getAllowedDemos(Models, agent, 'published')
            if (!allowed.some(d => String(d._id) === String(demoId))) bad('embed.preview.demoId must be a published demo of this agent')
        }
        updates['embed.preview.demoId'] = demoId || null
    }

    // Custom images only arrive through the upload endpoint; patch can only clear it
    const imageUrl = read(input, 'preview.imageUrl')
    if (imageUrl !== undefined) {
        const current = (agent.embed && agent.embed.preview && agent.embed.preview.imageUrl) || ''
        if (imageUrl !== '' && imageUrl !== current) bad('Upload preview images via /embed/preview-image')
        updates['embed.preview.imageUrl'] = imageUrl
    }

    return updates
}
