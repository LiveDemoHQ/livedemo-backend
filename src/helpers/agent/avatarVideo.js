import helpers from '../livedemoHelpers.js'
import { stockAvatarVideoUrl } from './anam.js'
import { findAvatar as findLemonSliceAvatar, recordAvatarClip } from './lemonslice.js'

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

// recordLemonSliceClip job: once per custom avatar, right after upload. Throws so monq retries.
export async function recordLemonSliceClip(Models, avatarId) {
  const doc = await Models.LemonSliceAvatar.findById(avatarId).lean()
  if (!doc || doc.videoUrl) return

  const key = `screen-videos/avatar-lemonslice-${avatarId}.mp4`
  await recordAvatarClip(await findLemonSliceAvatar(Models, doc.workspaceId, avatarId), key)
  await helpers.makeCdnObjectPublic(key)

  const videoUrl = `${CDN_BASE}/${key}`
  await Models.LemonSliceAvatar.updateOne({ _id: doc._id }, { $set: { videoUrl } })
  // Agents that picked this face before the clip existed
  await Models.AiDemoAgent.updateMany(
    { workspaceId: doc.workspaceId, avatarProvider: 'lemonslice', lemonsliceAvatarId: String(doc._id) },
    { $set: { avatarVideoUrl: videoUrl } }
  )
}
