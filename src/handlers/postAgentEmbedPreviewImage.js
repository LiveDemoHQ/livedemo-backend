import short from 'short-uuid'
import helpers from '../helpers/livedemoHelpers.js'
import loadAgentInWorkspace from '../helpers/agent/loadAgentInWorkspace.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import { IMAGE_TYPES } from './postLemonSliceAvatar.js'

// The embed launcher picks <video> vs <img> from this extension (livedemo-web-app embedSdk/launcher.js)
export const VIDEO_TYPES = { 'video/mp4': '.mp4', 'video/webm': '.webm' }
export const PREVIEW_TYPES = { ...IMAGE_TYPES, ...VIDEO_TYPES }

// POST /workspaces/:workspaceId/agents/:agentId/embed/preview-image (multipart: image)
// Preview content: an image or a short video. The only way to set embed.preview.imageUrl,
// so the launcher never loads an arbitrary URL.
const handler = async function (req, res) {
    const { Models } = req.mongo
    const { workspaceId, agentId } = req.params

    try {
        const { authUser } = await helpers.authReq(req, Models)
        helpers.validateUserHasAccessToWorkspace(authUser, workspaceId)
        const agent = await loadAgentInWorkspace(Models, workspaceId, agentId)

        const file = req.file
        if (!file || !PREVIEW_TYPES[file.mimetype]) {
            httpError(ResponseCodes['400_BAD_REQUEST'], 'Upload a JPG, PNG, WebP, MP4 or WebM file')
        }

        const name = `agent-embed-preview-${short.uuid()}${PREVIEW_TYPES[file.mimetype]}`
        const upload = VIDEO_TYPES[file.mimetype]
            ? await helpers.uploadScreenVideo(file.buffer, file.mimetype, name)
            : await helpers.uploadBufferImage(file.buffer, file.mimetype, name)
        const updated = await Models.AiDemoAgent.findOneAndUpdate(
            { _id: agent._id },
            { $set: { 'embed.preview.imageUrl': upload.Location, 'embed.preview.source': 'custom' } },
            { new: true, lean: true }
        )

        sendJson(res, updated)
    } catch (error) {
        sendError(res, error)
    }
}

export default handler
