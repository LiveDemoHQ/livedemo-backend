import helpers from '../livedemoHelpers.js'
import { stockAvatarVideoUrl } from './anam.js'
import { findAvatar as findLemonSliceAvatar, recordAvatarClip } from './lemonslice.js'
import { workspaceApiKey } from './providerKeys.js'

const MAX_BYTES = 20 * 1024 * 1024
const CDN_BASE = 'https://livedemo-cdn.s3.us-east-1.amazonaws.com'
const copied = {}

// Face's short preview clip copied to our CDN (embed pill icon). Anam's clip is a
// signed URL that dies after 1h, LemonSlice's lives on their blob store.
// '' when the face has no clip or the copy fails; the pill falls back to the image.
export default async function avatarVideoUrl(Models, workspaceId, provider, avatarId) {
  if (!avatarId) return ''
  const name = `avatar-${provider}-${avatarId}.mp4`
  if (copied[name]) return copied[name]

  try {
    const avatar = provider === 'lemonslice' ? await findLemonSliceAvatar(Models, workspaceId, avatarId) : null
    // Custom avatars' clips are recorded straight into our bucket (recordLemonSliceClip)
    if (avatar && avatar.custom) return avatar.videoUrl
    const source = avatar ? avatar.videoUrl : await stockAvatarVideoUrl(avatarId)
    if (!source) return ''

    const res = await fetch(source)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length > MAX_BYTES) throw new Error(`clip is ${buffer.length} bytes`)
    const upload = await helpers.uploadScreenVideo(buffer, 'video/mp4', name)
    copied[name] = upload.Location
    return upload.Location
  } catch (err) {
    console.log('[avatarVideo] copy failed', name, err.message)
    return ''
  }
}

// recordLemonSliceClip job: queued from the editor (postLemonSliceAvatarClip). No retries,
// a failure sets clipStatus 'failed' and the editor offers Retry.
export async function recordLemonSliceClip(Models, avatarId) {
  const doc = await Models.LemonSliceAvatar.findById(avatarId).lean()
  if (!doc) return console.log('[avatarVideo] recordLemonSliceClip skipped, avatar not found', avatarId)
  if (doc.videoUrl) return console.log('[avatarVideo] recordLemonSliceClip skipped, clip exists', avatarId)

  console.log('[avatarVideo] recordLemonSliceClip start', avatarId, 'workspace', String(doc.workspaceId))
  const key = `screen-videos/avatar-lemonslice-${avatarId}.mp4`
  try {
    const apiKey = await workspaceApiKey(Models, doc.workspaceId, 'lemonslice')
    await recordAvatarClip(await findLemonSliceAvatar(Models, doc.workspaceId, avatarId), key, apiKey)
    await helpers.makeCdnObjectPublic(key)
  } catch (err) {
    await Models.LemonSliceAvatar.updateOne({ _id: doc._id }, { $set: { clipStatus: 'failed' } })
    throw err
  }

  const videoUrl = `${CDN_BASE}/${key}`
  await Models.LemonSliceAvatar.updateOne({ _id: doc._id }, { $set: { videoUrl, clipStatus: '' } })
  // Agents that picked this face before the clip existed
  const agents = await Models.AiDemoAgent.updateMany(
    { workspaceId: doc.workspaceId, avatarProvider: 'lemonslice', lemonsliceAvatarId: String(doc._id) },
    { $set: { avatarVideoUrl: videoUrl } }
  )
  console.log('[avatarVideo] recordLemonSliceClip done', avatarId, videoUrl, 'agents updated', agents.modifiedCount)
}
