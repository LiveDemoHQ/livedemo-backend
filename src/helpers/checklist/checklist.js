import mongoose from 'mongoose'
import { sanitizeUrl } from '@braintree/sanitize-url'
import ENV from '../../envServer.js'
import ResponseCodes from '../../constants/ResponseCodes.js'
import { httpError } from '../agent/http.js'
import helpers from '../livedemoHelpers.js'

// StoryDemo checklist (STORYDEMO_CHECKLIST_TECH_DESIGN.md): config normalization, player context, progress events
const { ObjectId } = mongoose.Types
const HEX24 = /^[a-f0-9]{24}$/i
const TOKEN = /^[a-f0-9]{32}$/
const MAX_PATH = 200
const STATES = ['hidden', 'closed', 'open']

export const isToken = value => TOKEN.test(String(value || ''))

function isCdnUrl(value) {

    try {
        const { protocol, hostname } = new URL(value)
        const cdnHost = ENV.LIVEDEMO_CDN_URL ? new URL(ENV.LIVEDEMO_CDN_URL).hostname : ''
        return protocol === 'https:' && (/^livedemo-cdn\.s3[a-z0-9.-]*\.amazonaws\.com$/.test(hostname) || hostname === cdnHost)
    } catch {
        return false
    }
}

const safeUrl = value => (value ? sanitizeUrl(value) : '')
const storyIdOf = item => (item.clickAction && item.clickAction.type === 'startDemo' && item.clickAction.storyId ? String(item.clickAction.storyId) : null)
// Any demo an item sends the viewer to (startDemo or openStep); only startDemo items are unique / demo-completed
const targetIdOf = item => (item.clickAction && ['startDemo', 'openStep'].includes(item.clickAction.type) && item.clickAction.storyId ? String(item.clickAction.storyId) : null)
const uniqueTargets = items => [...new Set(items.map(targetIdOf).filter(Boolean))]
const versionKey = items => items.map(item => `${item._id}:${targetIdOf(item) || ''}`).sort().join(',')

// Task demos a viewer may be sent to: same workspace, guided, not deleted
function findTaskStories(Models, workspaceId, storyIds, select = '_id') {
    if (!storyIds.length) return Promise.resolve([])
    return Models.Story.find({ _id: { $in: storyIds }, workspaceId, deletedAt: null, mode: { $ne: 'sandbox' } }).select(select).lean()
}

// Validated editor body → custom.checklist. Throws 400 on a bad task reference or image host.
export async function normalizeChecklist(Models, story, body) {
    const items = (body.items || []).map(item => ({ ...item, _id: item._id || String(new ObjectId()) }))
    const storyIds = items.map(storyIdOf).filter(Boolean)
    if (new Set(storyIds).size !== storyIds.length) httpError(ResponseCodes['400_BAD_REQUEST'], 'A demo can only be in the checklist once')

    const targetIds = uniqueTargets(items)
    const found = await findTaskStories(Models, story.workspaceId, targetIds)
    if (found.length !== targetIds.length) httpError(ResponseCodes['400_BAD_REQUEST'], 'Every task must be a guided demo in this workspace')

    const launcher = body.launcher || {}
    ;[body.logoUrl, launcher.iconUrl].filter(Boolean).forEach((value) => {
        if (!isCdnUrl(value)) httpError(ResponseCodes['400_BAD_REQUEST'], 'Images must be uploaded')
    })

    const stored = (story.custom && story.custom.checklist) || {}
    const storedItems = stored.items || []
    const version = (stored.version || 1) + (storedItems.length && versionKey(storedItems) !== versionKey(items) ? 1 : 0)

    return {
        ...body,
        launcher,
        items: items.map(item => ({ ...item, clickAction: { ...item.clickAction, url: safeUrl(item.clickAction.url) } })),
        ctaButtons: (body.ctaButtons || []).map(button => ({ ...button, url: safeUrl(button.url) })),
        version
    }
}

// Clone / import: a self-reference follows the copy, items pointing outside the target workspace are dropped.
// stepIds (old → new step _id) is set when the copy got new step ids (clone; import keeps them).
export async function copyChecklist(Models, checklist, { oldStoryId, newStoryId, workspaceId, stepIds }) {
    if (!checklist || !Array.isArray(checklist.items)) return checklist

    const isSelf = item => targetIdOf(item) === String(oldStoryId)
    const ids = uniqueTargets(checklist.items).filter(id => HEX24.test(id) && id !== String(oldStoryId))
    const found = new Set((await findTaskStories(Models, workspaceId, ids)).map(s => String(s._id)))
    const items = checklist.items
        .filter(item => !targetIdOf(item) || isSelf(item) || found.has(targetIdOf(item)))
        .map(item => (isSelf(item) ? {
            ...item,
            clickAction: {
                ...item.clickAction,
                storyId: newStoryId,
                stepId: (stepIds && item.clickAction.stepId && stepIds.get(String(item.clickAction.stepId))) || item.clickAction.stepId || null
            }
        } : item))
    return { ...checklist, items }
}

// Stories a checklist sends the viewer to; a "Make it yours" claim copies all of them (cloneStoryGraphForUser)
export const checklistTargetIds = checklist => (checklist && Array.isArray(checklist.items) ? uniqueTargets(checklist.items).filter(id => HEX24.test(id)) : [])

// Phase 2 of a claim, once every story of the graph is copied. storyIdMap / stepIdMaps: old id → new id.
// Item _ids are kept (local to the host); items whose target or step wasn't copied are dropped.
export function remapChecklistForClone(checklist, { storyIdMap, stepIdMaps }) {
    const items = (checklist.items || []).flatMap((item) => {
        const target = targetIdOf(item)
        if (!target) return [item]
        const storyId = storyIdMap.get(target)
        if (!storyId) return []
        if (item.clickAction.type !== 'openStep' || !item.clickAction.stepId) return [{ ...item, clickAction: { ...item.clickAction, storyId } }]
        const stepId = (stepIdMaps.get(target) || new Map()).get(String(item.clickAction.stepId))
        return stepId ? [{ ...item, clickAction: { ...item.clickAction, storyId, stepId } }] : []
    })
    return { ...checklist, items, version: 1 }
}

// Items the viewer sees: demo / step items whose demo is gone (deleted / sandbox) are hidden
export async function visibleItems(Models, host) {
    const items = host.custom.checklist.items || []
    const stories = await findTaskStories(Models, host.workspaceId, uniqueTargets(items), '_id name thumbnailImageUrl')
    const byId = new Map(stories.map(s => [String(s._id), s]))
    return items
        .filter(item => !targetIdOf(item) || byId.has(targetIdOf(item)))
        .map(item => ({ item, target: byId.get(targetIdOf(item)) || null }))
}

// Checklist for window.config. hostId = ?checklist=, token = ?cl=. Null when no checklist is in play.
export async function getChecklistContext(Models, story, { hostId, token, isEditor, hide, variables = [] } = {}) {
    if (hide) return null

    const viaParam = hostId && HEX24.test(String(hostId)) && String(hostId) !== String(story._id)
    const host = viaParam
        ? await Models.Story.findOne({ _id: hostId, workspaceId: story.workspaceId, deletedAt: null }).select('_id workspaceId isPublished custom.checklist custom.theme').lean()
        : story
    const checklist = host && host.custom && host.custom.checklist
    if (!checklist || !checklist.isActive || !checklist.items || !checklist.items.length) return null

    const items = await visibleItems(Models, host)
    const progress = !isEditor && isToken(token)
        ? await Models.ChecklistProgress.findOne({ token, hostStoryId: host._id }).select('completedItemIds state firstOpenedAt checklistVersion').lean()
        : null
    const vars = text => (variables.length ? helpers.replaceLinkVarsInText(text, { variables }) : text)

    return {
        hostStoryId: String(host._id),
        hostTheme: (host.custom && host.custom.theme) || {},
        persistProgress: !isEditor && !!host.isPublished,
        progress: progress && progress.checklistVersion === (checklist.version || 1)
            ? { token, completedItemIds: progress.completedItemIds.map(String), state: progress.state, firstOpenedAt: progress.firstOpenedAt }
            : null,
        checklist: {
            ...checklist,
            title: vars(checklist.title),
            description: vars(checklist.description),
            launcher: { ...checklist.launcher, text: vars((checklist.launcher && checklist.launcher.text) || '') },
            items: items.map(({ item, target }) => ({
                ...item,
                _id: String(item._id),
                clickAction: { ...item.clickAction, storyId: targetIdOf(item), stepId: item.clickAction.stepId ? String(item.clickAction.stepId) : null },
                title: vars(item.title || (target && target.name) || ''),
                description: vars(item.description),
                thumbnailImageUrl: target ? target.thumbnailImageUrl : ''
            }))
        }
    }
}

// window.config is inline JS: keep '</script>' in creator text from closing the tag
export const configJson = value => JSON.stringify(value).replace(/</g, '\\u003c')

// Untrusted viewer events → progress mutations. sessionStoryId = story of the verified Session sent with the batch.
// Returns { completedNow } so the caller knows if this batch finished the checklist.
export function applyProgressEvents(progress, items, events, { storyId, sessionStoryId, sessionId, now = Date.now() }) {
    const byId = new Map(items.map(item => [String(item._id), item]))
    const at = value => (Number.isFinite(value) && value >= (progress.startTimestamp || 0) && value <= now + 60000 ? value : now)
    const completed = new Set((progress.completedItemIds || []).map(String))
    const converted = new Set((progress.convertedItemIds || []).map(String))

    events.slice(0, 50).forEach((event) => {
        const e = event && typeof event === 'object' ? event : {}
        const item = byId.get(String(e.itemId))
        const itemStoryId = item && storyIdOf(item)

        if (e.type === 'item_open' && item && (!itemStoryId || itemStoryId === String(storyId))) {

            progress.path.push({ itemId: item._id, storyId: itemStoryId, openedAt: at(e.at), ...(sessionId ? { sessionId } : {}) })
        } else if (e.type === 'item_complete' && item && !completed.has(String(item._id))) {

            const byDemo = item.completion === 'demoComplete' && itemStoryId && itemStoryId === String(storyId) && sessionStoryId === itemStoryId
            const byClick = item.completion === 'click'
            if (byDemo || byClick) {

                completed.add(String(item._id))
                const entry = [...progress.path].reverse().find(p => String(p.itemId) === String(item._id) && !p.completedAt)
                if (entry) entry.completedAt = at(e.at)
            }
        } else if (e.type === 'converted' && item && item.clickAction.type === 'converted') {

            converted.add(String(item._id))
            progress.convertedAt = progress.convertedAt || at(e.at)
        } else if (e.type === 'cta_click') {

            progress.convertedAt = progress.convertedAt || at(e.at)
        } else if (e.type === 'state' && STATES.includes(e.state)) {

            progress.state = e.state
            if (e.state === 'open' && !progress.firstOpenedAt) progress.firstOpenedAt = at(e.at)
        }
    })

    if (progress.path.length > MAX_PATH) progress.path.splice(0, progress.path.length - MAX_PATH)
    progress.completedItemIds = [...completed]
    progress.convertedItemIds = [...converted]

    const completable = items.filter(item => item.completion !== 'none')
    const completedNow = !progress.completedAt && completable.length > 0 && completable.every(item => completed.has(String(item._id)))
    if (completedNow) progress.completedAt = now
    progress.lastSeenTimestamp = now
    return { completedNow }
}
