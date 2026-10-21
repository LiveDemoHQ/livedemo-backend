import mongoose from 'mongoose'
import ResponseCodes from '../../constants/ResponseCodes.js'
import { httpError } from '../agent/http.js'

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i
// ponytail: a page load that starts within this window of the chain's last click is
// treated as caused by that click. A typed URL right after a click is misread as a
// link; the author re-targets it in the Links tab. Upgrade: record nav cause in the extension.
const NAV_WINDOW_MS = 5000
// Fallback hit box around a click point with no element rect, in px
const POINT_BOX_PX = 48

function bad(message) {
    httpError(ResponseCodes['400_BAD_REQUEST'], message)
}

export function isObjectId(value) {
    return OBJECT_ID_RE.test(String(value || ''))
}

function pagePath(baseEvents) {
    const meta = (baseEvents || []).find(event => event && event.type === 4 && event.data && event.data.href)
    try {
        const url = new URL(meta.data.href)
        return url.pathname && url.pathname !== '/' ? url.pathname : url.hostname
    } catch {
        return ''
    }
}

function clickName(click, fallback) {
    const text = click && click.targetText ? String(click.targetText).replace(/^"|"$/g, '').replace(/\s+/g, ' ').trim() : ''
    if (!text) return fallback
    return text.length > 40 ? `${text.slice(0, 40)}…` : text
}

// Chains from segmentRrwebEvents -> ordered screen plan. Every recorded click becomes a
// link from the screen it was made on to the screen it produced. Unlike the guided
// processor, screens are named after the click that *led* to them, with no steps and
// no duplicated "Final" screen.
export function planSandboxScreens(chains) {
    const plan = []
    chains.forEach((chain, c) => {
        if (!chain.baseEvents || !chain.baseEvents.length) return
        const deltas = chain.deltas || []
        const baseIndex = plan.length
        const baseEvents = chain.baseEvents
        plan.push({
            role: 'base',
            baseIndex,
            events: baseEvents,
            fromTimeMs: baseEvents[0].timestamp,
            toTimeMs: baseEvents[baseEvents.length - 1].timestamp,
            name: pagePath(baseEvents) || `Page ${c + 1}`,
            outClick: deltas[0] || null,
            linkTo: deltas.length ? baseIndex + 1 : null,
            hidden: false
        })
        deltas.forEach((delta, d) => {
            const next = deltas[d + 1] || null
            plan.push({
                role: 'delta',
                baseIndex,
                events: delta.events,
                fromTimeMs: delta.fromTimeMs,
                toTimeMs: delta.toTimeMs,
                name: clickName(delta, `Screen ${plan.length + 1}`),
                outClick: next,
                linkTo: next ? plan.length + 1 : null,
                hidden: false
            })
        })

        // The click that caused the next full page load links to that page's base
        const nextChain = chains[c + 1]
        const lastClick = deltas[deltas.length - 1]
        const nextStart = nextChain && nextChain.baseEvents && nextChain.baseEvents[0] && nextChain.baseEvents[0].timestamp
        if (lastClick && lastClick.clickTimestamp != null && nextStart != null && nextStart - lastClick.clickTimestamp <= NAV_WINDOW_MS) {
            const owner = plan[plan.length - 2]
            owner.linkTo = plan.length
            plan[plan.length - 1].hidden = true // state just before unload, kept for replay only
        }
    })
    return plan
}

function clamp(value) {
    return Math.min(100, Math.max(0, Math.round(value * 100) / 100))
}

function cleanText(raw) {
    const text = String(raw || '').replace(/^"|"$/g, '').trim()
    return /" image$/.test(String(raw || '')) ? '' : text.slice(0, 200)
}

// Recorded click (+ its clickThumbnails meta) -> link anchor; rect is % of the viewport
export function anchorFromClick(click, meta, viewport) {
    const width = (viewport && viewport.width) || 0
    const height = (viewport && viewport.height) || 0
    const m = meta || {}
    const r = m.targetRect
    const x = typeof click.clickX === 'number' ? click.clickX : m.frameX
    const y = typeof click.clickY === 'number' ? click.clickY : m.frameY
    let rect = null
    if (width && height && r && r.width > 0 && r.height > 0) {

        rect = { x: clamp(r.x / width * 100), y: clamp(r.y / height * 100), width: clamp(r.width / width * 100), height: clamp(r.height / height * 100) }
    } else if (width && height && typeof x === 'number' && typeof y === 'number') {

        rect = {
            x: clamp((x - POINT_BOX_PX / 2) / width * 100),
            y: clamp((y - POINT_BOX_PX / 2) / height * 100),
            width: clamp(POINT_BOX_PX / width * 100),
            height: clamp(POINT_BOX_PX / height * 100)
        }
    }
    return {
        rrwebNodeId: typeof m.rrwebNodeId === 'number' ? m.rrwebNodeId : null,
        selector: typeof m.targetSelector === 'string' ? m.targetSelector.slice(0, 500) : '',
        matchText: cleanText(click.targetText || m.targetText),
        rect
    }
}

export function newSandbox(fields) {
    return {
        startScreenId: null,
        flows: [],
        allowEmbed: true,
        showFlowMenu: false,
        revealLinkHints: false,
        hintOnMisclick: true,
        resetScroll: true,
        keyboardNavigation: true,
        showLinkSuggestions: true,
        ...fields
    }
}

function text(value, max, label) {
    if (value === undefined || value === null) return ''
    if (typeof value !== 'string' || value.length > max) bad(`${label} must be text up to ${max} characters`)
    return value.trim()
}

function rectFrom(raw) {
    if (!raw) return null
    const keys = ['x', 'y', 'width', 'height']
    if (!keys.every(key => typeof raw[key] === 'number' && raw[key] >= 0 && raw[key] <= 100)) bad('anchor.rect values must be 0-100')
    return { x: raw.x, y: raw.y, width: raw.width, height: raw.height }
}

// Link body -> stored link. Targets must be screens / flows of this story.
// existing: the link being patched, so partial bodies keep its other fields
export function normalizeLink(body, { screenIds, flows }, existing = {}) {
    const input = body && typeof body === 'object' ? body : {}
    const merged = { ...existing, ...input, anchor: { ...(existing.anchor || {}), ...(input.anchor || {}) } }
    const gotoType = merged.gotoType
    if (!['screen', 'flow', 'website'].includes(gotoType)) bad('gotoType must be screen, flow or website')

    const link = {
        gotoType,
        gotoScreen: null,
        gotoFlowId: null,
        gotoWebsite: '',
        anchor: {
            rrwebNodeId: Number.isInteger(merged.anchor.rrwebNodeId) ? merged.anchor.rrwebNodeId : null,
            selector: text(merged.anchor.selector, 500, 'anchor.selector'),
            matchText: text(merged.anchor.matchText, 200, 'anchor.matchText'),
            rect: rectFrom(merged.anchor.rect)
        },
        isPrimary: merged.isPrimary !== false,
        source: ['capture', 'manual', 'sync'].includes(merged.source) ? merged.source : 'manual',
        presenterNote: text(merged.presenterNote, 2000, 'presenterNote')
    }
    if (gotoType === 'screen') {

        if (!screenIds.has(String(merged.gotoScreen))) bad('gotoScreen must be a screen of this sandbox')
        link.gotoScreen = String(merged.gotoScreen)
    }
    if (gotoType === 'flow') {

        const flow = flows.find(f => String(f._id) === String(merged.gotoFlowId))
        if (!flow) bad('gotoFlowId must be a flow of this sandbox')
        link.gotoFlowId = String(flow._id)
        link.gotoScreen = flow.startScreenId ? String(flow.startScreenId) : null
    }
    if (gotoType === 'website') {

        link.gotoWebsite = text(merged.gotoWebsite, 1000, 'gotoWebsite')
        if (!/^https?:\/\/[^\s"'<>]+$/i.test(link.gotoWebsite)) bad('gotoWebsite must be an http(s) URL')
    }
    if (!link.anchor.rect && !link.anchor.selector && !link.anchor.matchText && link.anchor.rrwebNodeId === null) bad('anchor needs a rect, selector, text or node id')
    return link
}

// PATCH /sandbox flows -> stored flows. Keeps known _ids (Showcase items point at them),
// a screen sits in one flow at most, every id must be a screen of this story.
export function normalizeFlows(list, { screenIds, currentFlows }) {
    if (!Array.isArray(list)) bad('flows must be an array')
    if (list.length > 50) bad('Up to 50 flows')
    const known = new Set((currentFlows || []).map(f => String(f._id)))
    const taken = new Set()
    const own = ids => (Array.isArray(ids) ? ids : []).map(String).filter(id => screenIds.has(id))

    return list.map((raw, i) => {
        const flow = raw && typeof raw === 'object' ? raw : {}
        const ids = own(flow.screenIds).filter(id => !taken.has(id) && taken.add(id))
        const start = screenIds.has(String(flow.startScreenId)) ? String(flow.startScreenId) : (ids[0] || null)
        const completion = flow.completion || {}
        const type = ['none', 'screen', 'visitAll'].includes(completion.type) ? completion.type : 'none'
        const minutes = Number.isInteger(flow.estimatedMinutes) && flow.estimatedMinutes >= 0 && flow.estimatedMinutes <= 600 ? flow.estimatedMinutes : 0
        return {
            _id: known.has(String(flow._id)) ? String(flow._id) : new mongoose.Types.ObjectId(),
            name: text(flow.name, 120, `flows[${i}].name`) || `Flow ${i + 1}`,
            description: text(flow.description, 300, `flows[${i}].description`),
            startScreenId: start,
            screenIds: ids,
            completion: { type, screenIds: type === 'screen' ? own(completion.screenIds) : [] },
            estimatedMinutes: minutes,
            recordingFilePath: ((currentFlows || []).find(f => String(f._id) === String(flow._id)) || {}).recordingFilePath || ''
        }
    })
}

// Clone: old screen id -> new id map (Map of string -> ObjectId). Flows get new ids too.
// Returns the remapped sandbox and a function that remaps one screen's sandbox fields.
export function remapSandbox(sandbox, screenIdMap) {
    const screen = id => (id ? screenIdMap.get(String(id)) || null : null)
    const flowIdMap = new Map((sandbox.flows || []).map(flow => [String(flow._id), new mongoose.Types.ObjectId()]))
    const remapped = {
        ...sandbox,
        startScreenId: screen(sandbox.startScreenId),
        flows: (sandbox.flows || []).map(flow => ({
            ...flow,
            _id: flowIdMap.get(String(flow._id)),
            startScreenId: screen(flow.startScreenId),
            screenIds: (flow.screenIds || []).map(screen).filter(Boolean),
            completion: { ...flow.completion, screenIds: ((flow.completion && flow.completion.screenIds) || []).map(screen).filter(Boolean) }
        }))
    }
    const screenFields = s => ({
        ...(s.sandboxLinks ? {
            sandboxLinks: s.sandboxLinks.map(({ _id, ...link }) => ({
                ...link,
                gotoScreen: screen(link.gotoScreen),
                gotoFlowId: link.gotoFlowId ? flowIdMap.get(String(link.gotoFlowId)) || null : null
            }))
        } : {}),
        ...(s.sandboxDuplicateOf ? { sandboxDuplicateOf: screen(s.sandboxDuplicateOf) } : {})
    })
    return { sandbox: remapped, screenFields }
}

export const SETTINGS = [
    'allowEmbed',
    'showFlowMenu',
    'revealLinkHints',
    'hintOnMisclick',
    'resetScroll',
    'keyboardNavigation',
    'showLinkSuggestions'
]
