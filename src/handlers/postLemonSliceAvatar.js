import short from 'short-uuid'
import helpers from '../helpers/livedemoHelpers.js'
import { assertConfigured, createAvatarVariant, reframeWithSession } from '../helpers/agent/lemonslice.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import enqueueJob from '../helpers/enqueueJob.js'

const CLIP_RETRY = { attempts: { count: 3, delay: 60000, strategy: 'exponential' } }

// ponytail: flat per-workspace cap. Upgrade: tie it to the plan like cloned voices.
export const MAX_CUSTOM_AVATARS = 20
export const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }

// POST /workspaces/:workspaceId/lemonslice-avatars (multipart: image, name)
// Photo -> our S3 -> LemonSlice head-and-shoulders crop: avatar-variants if the
// account has it, else a one-off reframing session. If both fail the raw upload
// is kept and LemonSlice reframes it when a visitor's session starts.
const handler = async function (req, res) {
  const { Models } = req.mongo
  const { workspaceId } = req.params

  try {
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, workspaceId)

    const file = req.file
    if (!file || !IMAGE_TYPES[file.mimetype]) {
      httpError(ResponseCodes['400_BAD_REQUEST'], 'Upload a JPG, PNG or WebP image')
    }
    const name = String((req.body && req.body.name) || '').trim().slice(0, 60) || 'Custom avatar'

    if (await Models.LemonSliceAvatar.countDocuments({ workspaceId }) >= MAX_CUSTOM_AVATARS) {
      httpError(ResponseCodes['409_CONFLICT'], `A workspace can have up to ${MAX_CUSTOM_AVATARS} custom avatars`)
    }

    assertConfigured()
    const upload = await helpers.uploadBufferImage(file.buffer, file.mimetype, `lemonslice-${short.uuid()}${IMAGE_TYPES[file.mimetype]}`)
    const sourceImageUrl = upload.Location
    // A content-policy rejection (400) fails the upload; an outage keeps the raw
    // image and lets the visitor's session reframe it.
    const variantUrl = await createAvatarVariant(sourceImageUrl) ||
      await reframeWithSession(sourceImageUrl).catch((err) => {
        if (err.resultResponse?.statusCode === ResponseCodes['400_BAD_REQUEST']) throw err
        return null
      })

    const doc = await new Models.LemonSliceAvatar({
      workspaceId,
      name,
      imageUrl: variantUrl || sourceImageUrl,
      sourceImageUrl,
      reframed: !!variantUrl,
      createdBy: authUser._id,
    }).save()

    enqueueJob('agent-session', 'recordLemonSliceClip', { lemonsliceAvatarId: String(doc._id) }, CLIP_RETRY)
      .catch(err => console.log('[lemonslice] enqueue clip failed', err.message))

    sendJson(res, {
      id: String(doc._id), displayName: doc.name, imageUrl: doc.imageUrl, custom: true, reframed: doc.reframed,
    })
  } catch (error) {
    sendError(res, error)
  }
}

export default handler
