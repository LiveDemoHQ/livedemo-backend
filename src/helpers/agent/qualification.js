// Pure qualification logic: author config validation, trust-ranked field
// writes, and the deterministic "is this visitor qualified" rule check.
// No DB, no network — see qualification.check.js.

const MAX_FIELDS = 10
const TYPES = ['text', 'number', 'select', 'boolean']
const OPS = ['', 'any', 'gte', 'lte', 'eq', 'in']

// name/email are always recordable so a chat can turn into a lead
export const BUILT_IN_FIELDS = [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'company', label: 'Company', type: 'text' }
]

// Higher wins. Equal rank overwrites (latest value), lower never does.
export const SOURCE_RANK = {
    enrichment: 1,
    extracted: 2,
    self_reported: 3,
    crm: 3,
    host: 3,
    user_confirmed: 4,
    system: 5
}

const clip = (value, max) => String(value == null ? '' : value).trim().slice(0, max)

function bad(message) {
    const error = new Error(message)
    error.isValidation = true
    throw error
}

export function normalizeKey(raw) {
    return clip(raw, 40).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

// PATCH body.qualification -> stored shape. Throws error.isValidation on bad input.
export function normalizeQualification(input) {
    if (!input || typeof input !== 'object') bad('qualification must be an object')
    const fields = Array.isArray(input.fields) ? input.fields : []
    if (fields.length > MAX_FIELDS) bad(`Up to ${MAX_FIELDS} qualification fields`)

    const seen = new Set(BUILT_IN_FIELDS.map(f => f.key))
    const normalized = fields.map((field) => {
        const key = normalizeKey(field.key || field.label)
        if (!key) bad('Every qualification field needs a key or label')
        if (seen.has(key)) bad(`Duplicate or reserved field key: ${key}`)
        seen.add(key)

        const type = TYPES.includes(field.type) ? field.type : 'text'
        const options = type === 'select'
            ? (Array.isArray(field.options) ? field.options : []).map(o => clip(o, 80)).filter(Boolean).slice(0, 20)
            : []
        const rule = field.rule && typeof field.rule === 'object' ? field.rule : {}
        const op = OPS.includes(rule.op) ? rule.op : ''
        let value = rule.value
        if (op === 'gte' || op === 'lte') {
            value = Number(value)
            if (!Number.isFinite(value)) bad(`${key}: rule needs a number`)
        } else if (op === 'in') {
            value = (Array.isArray(value) ? value : [value]).map(v => clip(v, 80)).filter(Boolean)
            if (!value.length) bad(`${key}: rule needs at least one allowed option`)
        } else if (op === 'eq') {
            value = value === true || value === 'true'
        } else {
            value = null
        }

        return {
            key,
            label: clip(field.label, 80) || key,
            question: clip(field.question, 300),
            type,
            options,
            required: !!field.required,
            rule: { op, value }
        }
    })

    return {
        enabled: !!input.enabled,
        gateBooking: input.gateBooking !== false,
        fields: normalized
    }
}

export function allFields(agent) {
    const custom = (agent.qualification && agent.qualification.fields) || []
    return [...BUILT_IN_FIELDS, ...custom]
}

// Model output -> typed value, or undefined when it doesn't fit the field
export function coerceValue(field, raw) {
    if (raw === undefined || raw === null || raw === '') return undefined
    if (field.type === 'number') {
        const match = String(raw).replace(/,/g, '').match(/-?\d+(\.\d+)?/)
        const n = match ? Number(match[0]) : NaN
        if (!Number.isFinite(n)) return undefined
        return /\d\s*k\b/i.test(String(raw)) ? n * 1000 : n
    }
    if (field.type === 'boolean') {
        if (typeof raw === 'boolean') return raw
        const s = String(raw).toLowerCase()
        if (['yes', 'true', 'y', '1'].includes(s)) return true
        if (['no', 'false', 'n', '0'].includes(s)) return false
        return undefined
    }
    if (field.type === 'select') {
        const s = String(raw).trim().toLowerCase()
        return (field.options || []).find(o => o.toLowerCase() === s) || undefined
    }
    if (field.key === 'email') {
        const email = clip(raw, 254).toLowerCase()
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined
    }
    return clip(raw, 300) || undefined
}

// Returns the next fields object, or null when the write loses to a more trusted value
export function writeField(fields, key, value, source, at = new Date()) {
    const current = fields && fields[key]
    if (current && (SOURCE_RANK[source] || 0) < (SOURCE_RANK[current.source] || 0)) return null
    return { ...(fields || {}), [key]: { value, source, at } }
}

function passes(field, entry) {
    const value = entry && entry.value
    const op = field.rule && field.rule.op
    if (!op) return true
    if (value === undefined || value === null || value === '') return false
    if (op === 'any') return true
    if (op === 'gte') return Number(value) >= field.rule.value
    if (op === 'lte') return Number(value) <= field.rule.value
    if (op === 'eq') return value === field.rule.value
    if (op === 'in') return (field.rule.value || []).map(v => String(v).toLowerCase()).includes(String(value).toLowerCase())
    return false
}

// Rules set: every rule must pass. No rules: every required field answered.
export function isQualified(agent, fields) {
    const q = agent.qualification || {}
    if (!q.enabled) return false
    const list = q.fields || []
    const ruled = list.filter(f => f.rule && f.rule.op)
    if (ruled.length) return ruled.every(f => passes(f, fields && fields[f.key]))
    const required = list.filter(f => f.required)
    return required.length > 0 && required.every(f => fields && fields[f.key] && fields[f.key].value !== undefined)
}

export function missingFields(agent, fields) {
    const q = agent.qualification || {}
    if (!q.enabled) return []
    return (q.fields || []).filter(f => !(fields && fields[f.key]))
}

// Plain values for webhooks / HubSpot notes / UI: { key: value }
export function flattenFields(fields) {
    return Object.entries(fields || {}).reduce((acc, [key, entry]) => {
        acc[key] = entry && typeof entry === 'object' && 'value' in entry ? entry.value : entry
        return acc
    }, {})
}
