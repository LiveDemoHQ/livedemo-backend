import helpers from '../livedemoHelpers.js'
import { stockAvatarVideoUrl } from './anam.js'
import { findAvatar as findLemonSliceAvatar } from './lemonslice.js'

const MAX_BYTES = 20 * 1024 * 1024
const copied = {}

// Face's short preview clip copied to our CDN (embed pill icon). Anam's clip is a
// signed URL that dies after 1h, LemonSlice's lives on their blob store.
// '' when the face has no clip or the copy fails; the pill falls back to the image.
export default async function avatarVideoUrl(Models, workspaceId, provider, avatarId) {
  if (!avatarId) return ''
  const name = `avatar-${provider}-${avatarId}.mp4`
  if (copied[name]) return copied[name]

  try {
    const source = provider === 'lemonslice'
      ? (await findLemonSliceAvatar(Models, workspaceId, avatarId))?.videoUrl
      : await stockAvatarVideoUrl(avatarId)
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
