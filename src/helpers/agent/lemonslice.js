import crypto from 'crypto'
import ENV from '../../envServer.js'
import ResponseCodes from '../../constants/ResponseCodes.js'
import { httpError } from './http.js'
import { workspaceApiKey } from './providerKeys.js'

// LemonSlice = face only. It joins a LiveKit room, lip-syncs the ElevenLabs PCM
// the browser streams to it (topic lk.audio_stream) and publishes audio + video
// on behalf of the visitor. LIVEKIT_URL must be public: LemonSlice's servers join it.
// https://lemonslice.com/docs/api-reference/create-session
const LEMONSLICE_SESSIONS_API = 'https://lemonslice.com/api/liveai/sessions'
const LEMONSLICE_VARIANTS_API = 'https://lemonslice.com/api/liveai/avatar-variants'
const AVATAR_VARIANT = 'bust'
export const AVATAR_IDENTITY = 'lemonslice-avatar-agent'
const TOKEN_TTL_S = 60 * 60
// Default is 60s; a visitor reading a demo in silence would lose the face.
const IDLE_TIMEOUT_S = 300

// LemonSlice has no list API. These are the stock 2x3, non-green-screen avatars
// from lemonslice.com/avatars; sessions use agent_image_url so any API key works.
// Clips are each avatar's first_video_url from LemonSlice's agent_configs (prod).
// ponytail: hardcoded list. Upgrade: sync from LemonSlice if they ship a list endpoint.
const BLOB = 'https://6ammc3n5zzf5ljnz.public.blob.vercel-storage.com/'
const IMAGE_BASE = `${BLOB}inf2-image-uploads/`
const CLIP_BASE = `${BLOB}live-clips/liveChatClip-`
const STOCK = [
  ['agent_844edc579d3e8f2e', '1950s Advice Columnist', 'image-uFBMfKKsU31EcH4afYhMbhqlpifexx.jpg', 'V8e1SzKtcHbeY19nCODvMD8rXM7SNc'],
  ['agent_c9b4a627ac7e57c7', 'AI Therapist', 'resized-image-kwjq42DgmDnVqes43fsrKf5GMWZXni.jpg', 'HBc051eicXHXASVInpiv2VyJGiMOtL'],
  ['agent_9120bb1de93652c3', 'Amelia Lemons', 'resized-image-Ds496q9MREcQy4ee0lmRFdeKUKSyk6.jpg', '3OenGdqtBO2mN95OVo1FptIOPk1yy7'],
  ['agent_0e7b2576445eea53', 'Arts & Crafts Teacher', 'image-rJ9KuLAVT6oCkIYmBhA4TMNC0LDO0Q.jpg', 'zw9ASmasOc8xZUchQpPYz8zuoijrBi'],
  ['agent_24f0cceda8ce8e17', 'Business Coach', 'resized-image-cZE3BaAKDLjSmYL1imWXIY5JXszfNa.jpg', '1tpXEX3KiDIqi1XpdG7Im9qUWlbNSC'],
  ['agent_49a436c8d65c041b', 'Cat Girl', 'image_1257f-w1QMVZLIkkZPpOsrJNlWeT2jqqIEUf.png', 'Oprbgv7GiFFxJSkpCt0MBmQXmNeeyK'],
  ['agent_25790de244bb3fc5', 'Customer Support', 'image-jU5YjJYHEzEOgeP0GbQpwduKjk0gqV.jpg', 'hHKd7LRgFi6Io0JBJ4kRdexub7QEpV'],
  ['agent_ec9045b850b7547f', 'Fortnite Guide', 'resized-image-17UG786lUwcsK1GW9qeFSKgbOXabmH.jpg', 'aYacSuFWHo7RkVmPBTwVduBVfPH6f4'],
  ['agent_420193ff7fe067dd', 'Interviewer - Consulting', 'resized-image-uNfUa8uNouOoNcQJxRGmIm51QyH2lg.jpg', 'N0W5pZQlZ4R0A7n7sYHeN3OWBgc3ED'],
  ['agent_d0dcb7fe64c6d460', 'Lead Qualification', 'resized-image-uD3MLQD7MDw2dYfhoLPSbPQhMKkiVj.jpg', 'Yj330RaftzyAMen8PM2PuGt5N9cqOn'],
  ['agent_f529fb6892615c5f', 'Leila', 'resized-image-LIDU5Tv6NHi8hBXXnKc6m5GXvdyXTv.jpg', 'YpMZ26YrnwBifSvh4PoCWOphRpjFkI'],
  ['agent_d1812167e99b576f', 'Live Seller', 'resized-image-gjxvtJR6JFL15YVPUPO2NiVYEMu0rd.jpg', 'woY6qapHOdwZgMtfPjyKlTxNxruim4'],
  ['agent_037be4ec44f07a9a', 'Michelin Restaurant Guide', 'resized-image-HFd2kKeQqXPW1MZU5CcdpCIExkxJ3V.jpg', '48z75BOprl4J1hT1b3nDFvZrGdmT8z'],
  ['agent_23e795b59ce14a71', 'Mock Patient', 'resized-image-hCubh1XS6qieTVEDP5CQmappyHeEHR.jpg', '30zbIzaeeL8c3MJqdvdODJ3hUzURB7'],
  ['agent_4cfba36bea70a4fa', 'Museum Guide', 'resized-image-g0rLSqnhnfsISvt2pBRbU7HhDvFtr9.jpg', 'iDxfs0DLbNjvnDUOO1DhcDKMyTWuaB'],
  ['agent_0adb5182edf7e1e3', 'Podcast Host', 'resized-image-nYuCYbXBJKzPgxgfwENB6ljMlrm6y8.jpg', `${IMAGE_BASE}video-wHQULFOgZA11ocxq9lth8aHMtNL1On.mp4`],
  ['agent_a3cbabdea998c7de', 'San Francisco City Guide', 'resized-image-8S7zjJAMErEJrisyUrtXS3IiRI3LQM.jpg', 'FymuViSLFeZYeVGxvgXFzXzhZ0mOw4'],
  ['agent_baef12ca2d3ab7a8', 'Santa Claus', 'resized-image-JvLOJBYdDONm8MyjXBinkFPBRVh41V.jpg', 'BtFHFsxtQ7h9BiEh6ZAjf8pZ9SQ83M'],
  ['agent_75d5cf48766b4554', 'Social Worker', 'resized-image-q5KWjWRzGXkKSDlOS2qoU1z7AC9l6J.jpg', 'c6M1KLr6CqG24jzOieI77uNe1hIK9d'],
  ['agent_45aea815fad8a9c1', 'Spanish Practice', 'resized-image-mRFgEr5lqAtGYsplJ0bpbg43Gwjx4D.jpg', 't0APvaCQVuQfdOH0TCo1bBzOBEhlHw'],
  ['agent_6f66b11cfa77ec44', 'Streaming Companion', 'resized-image-G41lgLivlP7pU9CBCZPG69XNQqPNoc.jpg', 'iIgnEc3hbNeqasrSJUlyabdHf8HUfZ'],
]
export const STOCK_AVATARS = STOCK.map(([id, displayName, image, clip]) => ({
  id,
  displayName,
  imageUrl: IMAGE_BASE + image,
  videoUrl: clip.startsWith('https://') ? clip : `${CLIP_BASE}${clip}.mp4`,
}))

export function findStockAvatar(avatarId) {
  return STOCK_AVATARS.find(a => a.id === avatarId) || null
}

const OBJECT_ID = /^[a-f0-9]{24}$/
// A clip job takes ~30s; pending longer than this means the worker died mid-job
export const CLIP_STALE_MS = 5 * 60 * 1000

export function clipStatus(doc, now = Date.now()) {
  if (doc.videoUrl) return 'ready'
  if (doc.clipStatus === 'pending' && now - new Date(doc.updatedAt).getTime() > CLIP_STALE_MS) return 'failed'
  return doc.clipStatus || ''
}

function customAvatar(doc) {
  return {
    id: String(doc._id),
    displayName: doc.name || 'Custom avatar',
    imageUrl: doc.imageUrl,
    videoUrl: doc.videoUrl || '',
    clipStatus: clipStatus(doc),
    custom: true,
    reframed: !!doc.reframed
  }
}

// Workspace customs first, then stock
export async function listAvatars(Models, workspaceId) {
  const docs = await Models.LemonSliceAvatar.find({ workspaceId }).sort({ createdAt: -1 }).lean()
  return [...docs.map(customAvatar), ...STOCK_AVATARS]
}

// Stock id, or a custom avatar of THIS workspace
export async function findAvatar(Models, workspaceId, avatarId) {
  const id = String(avatarId || '')
  if (!OBJECT_ID.test(id)) return findStockAvatar(id)
  const doc = await Models.LemonSliceAvatar.findOne({ _id: id, workspaceId }).lean()
  return doc ? customAvatar(doc) : null
}

// Head-and-shoulders crop of an uploaded photo. null when LemonSlice refuses
// (403 = avatar optimization not enabled on the account, 422 = content policy).
// apiKey on every billed call: the workspace's own LemonSlice key (Growth), else ours.
export async function createAvatarVariant(imageUrl, apiKey) {
  try {
    const res = await fetch(LEMONSLICE_VARIANTS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ image_url: imageUrl, variant_ids: [AVATAR_VARIANT] }),
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok && body[AVATAR_VARIANT]) return body[AVATAR_VARIANT]
    console.log('[lemonslice] avatar-variants unavailable', res.status, JSON.stringify(body).slice(0, 300))
  } catch (err) {
    console.log('[lemonslice] avatar-variants network error', err.message)
  }
  return null
}

function base64url(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')
}

// Same HS256 claims livekit-server-sdk's AccessToken.toJwt() signs.
export function livekitToken({ identity, room, grants = {}, kind, attributes }) {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: ENV.LIVEKIT_API_KEY,
    sub: identity,
    name: identity,
    nbf: now,
    exp: now + TOKEN_TTL_S,
    video: { roomJoin: true, room, ...grants },
    ...(kind ? { kind } : {}),
    ...(attributes ? { attributes } : {}),
  }
  const unsigned = `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(payload)}`
  const signature = crypto.createHmac('sha256', ENV.LIVEKIT_API_SECRET).update(unsigned).digest('base64url')
  return `${unsigned}.${signature}`
}

export function buildSessionBody(avatar, avatarToken) {
  return {
    transport_type: 'livekit',
    properties: { livekit_url: ENV.LIVEKIT_URL, livekit_token: avatarToken },
    agent_image_url: avatar.imageUrl,
    idle_timeout: IDLE_TIMEOUT_S,
    // Stock and variant images are already framed; a raw upload gets reframed
    // by LemonSlice (it reuses the variant on later sessions).
    ...(avatar.custom && !avatar.reframed
      ? { edit_image: true, edit_image_variant: AVATAR_VARIANT }
      : { edit_image: false }),
  }
}

// One LiveKit room per visitor session. The browser only subscribes and sends
// data (audio byte stream + lk.clear_buffer RPC); LemonSlice publishes the face.
export function assertConfigured(apiKey) {
  const missing = [
    !apiKey && 'LEMONSLICE_API_KEY',
    !ENV.LIVEKIT_URL && 'LIVEKIT_URL',
    !ENV.LIVEKIT_API_KEY && 'LIVEKIT_API_KEY',
    !ENV.LIVEKIT_API_SECRET && 'LIVEKIT_API_SECRET'
  ].filter(Boolean)
  if (missing.length) {
    console.log('[lemonslice] not configured, missing:', missing.join(', '))
    httpError(ResponseCodes['503_SERVICE_UNAVAILABLE'], 'Avatar service is not configured')
  }
}

export async function createLemonSliceSession(Models, agent) {
  const apiKey = await workspaceApiKey(Models, agent.workspaceId, 'lemonslice')
  assertConfigured(apiKey)
  const avatar = await findAvatar(Models, agent.workspaceId, agent.lemonsliceAvatarId)
  if (!avatar) httpError(ResponseCodes['400_BAD_REQUEST'], 'Avatar is not enabled for this agent')

  const suffix = crypto.randomBytes(8).toString('hex')
  const room = `ld-agent-${agent._id}-${suffix}`
  const identity = `visitor-${suffix}`
  const token = livekitToken({ identity, room, grants: { canPublish: false, canSubscribe: true, canPublishData: true } })
  const avatarToken = livekitToken({
    identity: AVATAR_IDENTITY,
    room,
    kind: 'agent',
    attributes: { 'lk.publish_on_behalf': identity },
  })

  await postSession(buildSessionBody(avatar, avatarToken), { agentId: String(agent._id), avatarId: avatar.id }, apiKey)
  return { livekitUrl: ENV.LIVEKIT_URL, token, avatarIdentity: AVATAR_IDENTITY }
}

async function postSession(body, context, apiKey) {
  const startedAt = Date.now()
  let res
  try {
    res = await fetch(LEMONSLICE_SESSIONS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.log('[lemonslice] network error', context, err.message)
    httpError(ResponseCodes['503_SERVICE_UNAVAILABLE'], 'Avatar service unavailable')
  }

  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 500)
    console.log('[lemonslice] session failed', res.status, `${Date.now() - startedAt}ms`, context, text)
    if (res.status === 429) httpError(ResponseCodes['429_TOO_MANY_REQUESTS'], 'Avatar service is busy, try again shortly')
    if (res.status === 422) httpError(ResponseCodes['400_BAD_REQUEST'], 'LemonSlice rejected this image, try another photo')
    httpError(ResponseCodes['503_SERVICE_UNAVAILABLE'], 'Avatar service unavailable')
  }
  return res.json()
}

// Reframing inside a session blocks the POST ~7s and returns edited_image_url.
// Done once at upload in a throwaway room, terminated right away, so visitors
// never wait for it. null if LemonSlice gave no edited image.
export async function reframeWithSession(imageUrl, apiKey) {
  const room = `ld-avatar-prep-${crypto.randomBytes(8).toString('hex')}`
  const avatarToken = livekitToken({ identity: AVATAR_IDENTITY, room, kind: 'agent', attributes: { 'lk.publish_on_behalf': 'nobody' } })
  console.log('[lemonslice] reframe session start', room)
  const session = await postSession(buildSessionBody({ imageUrl, custom: true, reframed: false }, avatarToken), { prep: room }, apiKey)
  terminateSession(session, apiKey)
  console.log('[lemonslice] reframe session done', room, session.edited_image_url ? 'edited image returned' : 'no edited image')
  return session.edited_image_url || null
}

function terminateSession(session, apiKey) {
  if (!session.control_url) return
  fetch(session.control_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({ event: 'terminate' }),
  }).catch(err => console.log('[lemonslice] terminate failed', err.message))
}

const CLIP_SECONDS = 6
const RECORDER_IDENTITY = 'ld-clip-recorder'
const EGRESS_FAILED = ['EGRESS_FAILED', 'EGRESS_ABORTED', 'EGRESS_LIMIT_REACHED']
// LemonSlice joins and starts rendering a few seconds after the session POST
const AVATAR_JOIN_TIMEOUT_MS = 60000
const AVATAR_WARMUP_MS = 1500
// 6s at 1.2 Mbps is ~900 KB; an all-black clip is ~10 KB
export const MIN_CLIP_BYTES = 100 * 1024
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// LiveKit server APIs over Twirp (https://docs.livekit.io/reference/other/egress/api)
async function livekitRpc(service, method, room, body, grants) {
  const token = livekitToken({ identity: RECORDER_IDENTITY, room, grants })
  const host = ENV.LIVEKIT_URL.replace(/^ws/, 'http').replace(/\/+$/, '')
  const res = await fetch(`${host}/twirp/livekit.${service}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(`${service} ${method} ${res.status} ${JSON.stringify(json).slice(0, 300)}`)
    err.status = res.status
    throw err
  }
  return json
}

const egressRpc = (method, room, body) => livekitRpc('Egress', method, room, body, { roomRecord: true })

export const hasVideoTrack = (participants, identity) => (participants || []).some(p => p.identity === identity
  && (p.tracks || []).some(t => (t.type === 'VIDEO' || t.type === 1) && !t.muted))

// Egress starts instantly; recording before the face is published gives a black clip
async function waitForAvatarVideo(room) {
  const deadline = Date.now() + AVATAR_JOIN_TIMEOUT_MS
  while (Date.now() < deadline) {
    // LiveKit creates the room when LemonSlice joins; until then it's a 404
    const { participants } = await livekitRpc('RoomService', 'ListParticipants', room, { room }, { roomAdmin: true })
      .catch((err) => {
        if (err.status === 404) return {}
        throw err
      })
    if (hasVideoTrack(participants, AVATAR_IDENTITY)) return sleep(AVATAR_WARMUP_MS)
    await sleep(1000)
  }
  throw new Error('avatar never published video')
}

// int64 sizes arrive as strings over Twirp JSON
export const clipBytes = info => Number(((info.file_results || [])[0] || info.file || {}).size || 0)

async function waitForEgress(room, egressId, status) {
  for (let i = 0; i < 90; i++) {
    const { items = [] } = await egressRpc('ListEgress', room, { egress_id: egressId })
    const info = items[0] || {}
    if (info.status === status) return info
    if (EGRESS_FAILED.includes(info.status)) throw new Error(`egress ${info.status} ${info.error || ''}`)
    await sleep(1000)
  }
  throw new Error(`egress never reached ${status}`)
}

// LemonSlice only has clips for its own stock avatars, so custom ones get recorded:
// a throwaway session idles in its own room while LiveKit egress writes the face
// (video only, 2:3 like the avatar) straight to our bucket at `key`.
export async function recordAvatarClip(avatar, key, apiKey) {
  assertConfigured(apiKey)
  const room = `ld-avatar-clip-${crypto.randomBytes(8).toString('hex')}`
  const avatarToken = livekitToken({ identity: AVATAR_IDENTITY, room, kind: 'agent', attributes: { 'lk.publish_on_behalf': RECORDER_IDENTITY } })
  const startedAt = Date.now()
  const log = (...args) => console.log('[lemonslice] clip', room, `${Date.now() - startedAt}ms`, ...args)
  log('start', { avatarId: avatar && avatar.id, reframed: avatar && avatar.reframed, key })
  const session = await postSession(buildSessionBody(avatar, avatarToken), { clip: room }, apiKey)
  log('session created', { control: !!session.control_url })
  try {
    await waitForAvatarVideo(room)
    log('avatar video published')
    const egress = await egressRpc('StartEgress', room, {
      room_name: room,
      media: { participant_video: { identity: AVATAR_IDENTITY } },
      advanced: { width: 480, height: 720, framerate: 25, video_codec: 'H264_MAIN', video_bitrate: 1200 },
      outputs: [{ file: { file_type: 'MP4', filepath: key, disable_manifest: true } }],
      storage: { s3: { access_key: ENV.AWS_ACCESS_KEY_ID, secret: ENV.AWS_SECRET_ACCESS_KEY, region: 'us-east-1', bucket: 'livedemo-cdn' } },
    })
    log('egress started', egress.egress_id)
    await waitForEgress(room, egress.egress_id, 'EGRESS_ACTIVE')
    log('egress active, recording', `${CLIP_SECONDS}s`)
    await sleep(CLIP_SECONDS * 1000)
    await egressRpc('StopEgress', room, { egress_id: egress.egress_id })
    const done = await waitForEgress(room, egress.egress_id, 'EGRESS_COMPLETE')
    log('egress complete', `${clipBytes(done)} bytes`)
    if (clipBytes(done) < MIN_CLIP_BYTES) throw new Error(`clip looks blank (${clipBytes(done)} bytes)`)
  } catch (err) {
    log('failed', err.message)
    throw err
  } finally {
    terminateSession(session, apiKey)
  }
}
