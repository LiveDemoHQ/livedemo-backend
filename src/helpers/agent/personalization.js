// Values the demo player swaps into {{company}} / {{firstName}} / {{domain}} / {{logo}}.
// Pure — see qualification.check.js.

// ponytail: static free-mail list (same as embedSdk/launcher.js); swap for a maintained list if it matters
const FREE_MAIL = ['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com', 'gmx.com', 'mail.com', 'yandex.com']

const clip = (value, max) => String(value == null ? '' : value).trim().slice(0, max)

export function emailDomain(email) {
    const domain = clip(email, 254).toLowerCase().split('@')[1] || ''
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) && !FREE_MAIL.includes(domain) ? domain : ''
}

// acme-corp.co.uk -> "Acme Corp"
export function companyFromDomain(domain) {
    const label = String(domain || '').split('.')[0] || ''
    return label.split('-').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
}

// Later inputs win: pass the stored personalization first, fresh facts after
export function buildPersonalization(...inputs) {
    const merged = Object.assign({}, ...inputs.filter(Boolean))
    const domain = clip(merged.domain, 100).toLowerCase() || emailDomain(merged.email)
    const company = clip(merged.company, 80) || companyFromDomain(domain)
    const firstName = clip(merged.firstName, 60) || clip(merged.name, 120).split(/\s+/)[0] || ''
    const result = {}
    if (company) result.company = company
    if (firstName) result.firstName = firstName
    if (domain) {
        result.domain = domain
        result.logo = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`
    }
    return result
}

// Story preview ?vars= payload (base64url JSON). Values are HTML-escaped by getStoryPreview.
export function encodeVars(personalization) {
    const keys = Object.keys(personalization || {})
    return keys.length ? Buffer.from(JSON.stringify(personalization)).toString('base64url') : ''
}

const VAR_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/

// Untrusted query input -> [{ name, value }], or [] when malformed
export function decodeVars(raw) {
    if (!raw) return []
    try {
        const obj = JSON.parse(Buffer.from(String(raw).slice(0, 4000), 'base64url').toString('utf8'))
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return []
        return Object.entries(obj)
            .filter(([name, value]) => VAR_NAME_RE.test(name) && ['string', 'number'].includes(typeof value))
            .slice(0, 20)
            .map(([name, value]) => ({ name, value: clip(value, 200) }))
    } catch {
        return []
    }
}
