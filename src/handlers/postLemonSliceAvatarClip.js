import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import { assertConfigured, clipStatus, CLIP_STALE_MS } from '../helpers/agent/lemonslice.js'
import { workspaceApiKey } from '../helpers/agent/providerKeys.js'
import enqueueJob from '../helpers/enqueueJob.js'

import logger from '../helpers/logger.js'

// POST /workspaces/:workspaceId/lemonslice-avatars/:avatarId/clip
// Queues the idle-clip recording (recordLemonSliceClip). The editor polls
// GET lemonslice-avatars until clipStatus is 'ready' or 'failed'.
const handler = async function (req, res) {
  const { Models } = req.mongo
  const { workspaceId, avatarId } = req.params

  try {
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, workspaceId)

    const doc = await Models.LemonSliceAvatar.findOne({ _id: avatarId, workspaceId }).lean()
    if (!doc) httpError(ResponseCodes['404_NOT_FOUND'], 'Avatar not found')
    if (doc.videoUrl) return sendJson(res, { id: avatarId, videoUrl: doc.videoUrl, clipStatus: 'ready' })

    assertConfigured(await workspaceApiKey(Models, workspaceId, 'lemonslice'))

    // Claim atomically so double clicks don't record twice; a stale pending can be re-claimed
    const claimed = await Models.LemonSliceAvatar.findOneAndUpdate(
      {
        _id: avatarId,
        workspaceId,
        videoUrl: '',
        $or: [{ clipStatus: { $ne: 'pending' } }, { updatedAt: { $lt: new Date(Date.now() - CLIP_STALE_MS) } }]
      },
      { $set: { clipStatus: 'pending' } },
      { new: true }
    ).lean()
    if (!claimed) return sendJson(res, { id: avatarId, videoUrl: '', clipStatus: 'pending' })

    await enqueueJob('agent-session', 'recordLemonSliceClip', { lemonsliceAvatarId: avatarId })
      .catch(async (err) => {
        logger.error('[lemonslice] enqueue clip failed', { eventName: 'ENQUEUE_CLIP_FAILED', err: err.message })
        await Models.LemonSliceAvatar.updateOne({ _id: avatarId }, { $set: { clipStatus: 'failed' } })
        httpError(ResponseCodes['503_SERVICE_UNAVAILABLE'], 'Could not start the video, try again')
      })
    logger.info('[lemonslice] clip job enqueued', { eventName: 'CLIP_JOB_ENQUEUED', data: { detail: avatarId } })

    sendJson(res, { id: avatarId, videoUrl: '', clipStatus: clipStatus(claimed) })
  } catch (error) {
    sendError(res, error)
  }
}

export default handler
