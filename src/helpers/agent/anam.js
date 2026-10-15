import ENV from '../../envServer.js'
import ResponseCodes from '../../constants/ResponseCodes.js'
import { httpError } from './http.js'

// Anam = face (+ optionally voice). Brain is always Gemini: Anam's LLM is never
// used. ANAM_API_KEY never leaves the server; browsers get a session token.
const ANAM_API = 'https://api.anam.ai/v1'
const STOCK_CACHE_MS = 10 * 60 * 1000
const MAX_PAGES = 20

const stockCache = {}

function apiKey() {
  if (!ENV.ANAM_API_KEY) {
    console.log('[anam] ANAM_API_KEY is not configured')
    httpError(ResponseCodes['503_SERVICE_UNAVAILABLE'], 'ANAM_API_KEY is not configured')
  }
  return ENV.ANAM_API_KEY
}

function rateLimitHeaders(res) {
  const out = {}
  res.headers.forEach((value, key) => {
    if (key === 'retry-after' || key.includes('ratelimit')) out[key] = value
  })
  return out
}

// `context` (e.g. { agentId }) is only for the log line.
async function anamFetch(path, options = {}, context = {}) {
  const method = options.method || 'GET'
  const startedAt = Date.now()

  let res
  try {
    res = await fetch(`${ANAM_API}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey()}`,
        ...(options.headers || {}),
      },
    })
  } catch (err) {
    if (err.resultResponse) throw err
    console.log('[anam] network error', method, path, `${Date.now() - startedAt}ms`, context, err.message)
    httpError(ResponseCodes['503_SERVICE_UNAVAILABLE'], 'Avatar service unavailable')
  }

  if (res.ok) return res.json()

  const body = (await res.text().catch(() => '')).slice(0, 500)
  const ms = `${Date.now() - startedAt}ms`

  if (res.status === 429) {
    console.log('[anam] RATE LIMITED', method, path, ms, context, rateLimitHeaders(res), body)
    httpError(ResponseCodes['429_TOO_MANY_REQUESTS'], 'Avatar service is busy, try again shortly')
  }

  console.log('[anam] request failed', method, path, res.status, ms, context, body)
  httpError(ResponseCodes['503_SERVICE_UNAVAILABLE'], 'Avatar service unavailable')
}

// Every page of a list endpoint, stock rows only (createdByOrganizationId null).
// ponytail: in-process cache, one copy per pod. Upgrade: Redis if pods multiply.
async function listStock(path, mapRow, dedupeKey) {
  const cached = stockCache[path]
  if (cached && Date.now() - cached.at < STOCK_CACHE_MS) return cached.list

  const rows = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await anamFetch(`${path}?perPage=100&page=${page}`)
    rows.push(...(body.data || []))
    if (!body.meta || !body.meta.next) break
  }

  const seen = new Set()
  const list = rows
    .filter(r => r.createdByOrganizationId == null)
    .filter((r) => {
      if (!dedupeKey) return true
      const key = dedupeKey(r)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map(mapRow)
  stockCache[path] = { at: Date.now(), list }
  return list
}

// Signed video URLs never leave the server (they expire after 1h). They're kept
// here so patchAgent can copy the clip to our CDN; STOCK_CACHE_MS stays well under 1h.
const signedVideoUrls = {}

export function listStockAvatars() {
  return listStock('/avatars', (a) => {
    signedVideoUrls[a.id] = a.videoUrl || ''
    return mapAvatar(a)
  })
}

export async function stockAvatarVideoUrl(avatarId) {
  await listStockAvatars()
  return signedVideoUrls[avatarId] || ''
}

function mapAvatar(a) {
  return {
    id: a.id,
    displayName: a.displayName || '',
    variantName: a.variantName || '',
    imageUrl: a.imageUrl || '',
    activeVersion: a.activeVersion || '',
    availableVersions: a.availableVersions || [],
  }
}

// Anam lists one voice once per TTS model (same name, displayTags fast /
// expressive / slow), plus a few exact catalog duplicates — those are dropped.
export function listStockVoices() {
  return listStock('/voices', v => ({
    id: v.id,
    displayName: v.displayName || '',
    gender: v.gender || '',
    country: v.country || '',
    provider: v.provider || '',
    tags: v.displayTags || [],
    description: String(v.description || '').slice(0, 200),
    sampleUrl: v.sampleUrl || v.previewSampleUrl || '',
  }), v => [v.provider, String(v.providerModelId || '').trim(), v.providerVoiceId, v.displayName].join('|'))
}

export async function findStockAvatar(avatarId) {
  const list = await listStockAvatars()
  return list.find(a => a.id === avatarId) || null
}

export async function findStockVoice(voiceId) {
  const list = await listStockVoices()
  return list.find(v => v.id === voiceId) || null
}

// cara-4-latest is invite-only — never pick it implicitly.
export function pickAvatarModel(avatar) {
  const versions = avatar.availableVersions || []
  if (avatar.activeVersion && avatar.activeVersion !== 'cara-4-latest') return avatar.activeVersion
  return versions.find(v => v === 'cara-4') || versions.find(v => v === 'cara-3') || 'cara-4'
}

// ElevenLabs voice: passthrough, we pipe PCM. Anam voice: Anam TTS speaks text
// we send with talk(); CUSTOMER_CLIENT_V1 = no Anam LLM, Gemini stays the brain.
export function buildPersonaConfig(agent) {
  const base = {
    avatarId: agent.anamAvatarId,
    avatarModel: agent.anamAvatarModel || 'cara-4',
  }
  if (usesAnamVoice(agent)) {
    return { ...base, voiceId: agent.anamVoiceId, llmId: 'CUSTOMER_CLIENT_V1', skipGreeting: true }
  }
  return { ...base, enableAudioPassthrough: true }
}

export async function createAnamSessionToken(agent) {
  const personaConfig = buildPersonaConfig(agent)
  const context = {
    agentId: agent._id ? String(agent._id) : undefined,
    avatarId: personaConfig.avatarId,
    avatarModel: personaConfig.avatarModel,
    voiceId: personaConfig.voiceId,
  }
  const body = await anamFetch('/auth/session-token', {
    method: 'POST',
    body: JSON.stringify({ personaConfig }),
  }, context)
  if (!body.sessionToken) {
    console.log('[anam] session-token response had no sessionToken', context)
    httpError(ResponseCodes['503_SERVICE_UNAVAILABLE'], 'Avatar service unavailable')
  }
  return body.sessionToken
}

export function isLemonSlice(agent) {
  return agent.avatarProvider === 'lemonslice'
}

// Any provider: a live face means speech goes out as 16 kHz PCM.
export function avatarIsLive(agent) {
  return !!(agent.avatarsEnabled && (isLemonSlice(agent) ? agent.lemonsliceAvatarId : agent.anamAvatarId))
}

export function usesAnamVoice(agent) {
  return avatarIsLive(agent) && !isLemonSlice(agent) && agent.avatarVoice === 'anam' && !!agent.anamVoiceId
}
