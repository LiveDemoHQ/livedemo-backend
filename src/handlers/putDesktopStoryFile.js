import path from 'path'
import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import StoryStatuses from '../constants/StoryStatuses.js'
import ENV from '../envServer.js'
import {
    PART_BYTES,
    desktopStoryDir,
    safeDesktopFileName,
    writeFileAtOffset,
} from '../helpers/desktopStoryFiles.js'
import logger from '../helpers/logger.js'

const CORS_HEADERS = {
    'Access-Control-Max-Age': 600,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept,X-Offset',
    'Access-Control-Allow-Credentials': true,
}

function fail(statusCode, message) {
    const error = new Error(message)
    error.resultResponse = {
        statusCode,
        headers: CORS_HEADERS,
        body: JSON.stringify({ message }),
    }

    return error
}

// PUT /stories/:storyId/desktop-files/:name
// Raw bytes of video.mov or a click PNG. X-Offset is the byte position, so a retry overwrites the same range.
const handler = function (req, res) {
    const storyId = req.params.storyId
    const name = safeDesktopFileName(req.params.name)

    return Promise.resolve()
        .then(async () => {
            const { Models } = req.mongo
            const { authUser } = await helpers.authReq(req, Models)

            if (!name || !/^[a-fA-F0-9]{24}$/.test(String(storyId || ''))) {

                throw fail(ResponseCodes['400_BAD_REQUEST'], 'invalid desktop file')
            }

            const offset = Number(req.get('X-Offset') || 0)

            if (!Number.isInteger(offset) || offset < 0) {

                throw fail(ResponseCodes['400_BAD_REQUEST'], 'invalid offset')
            }

            const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)

            if (body.length > PART_BYTES) {

                throw fail(ResponseCodes['400_BAD_REQUEST'], 'desktop file part is too large')
            }

            const story = await Models.Story.findOne({
                _id: storyId,
                status: StoryStatuses.UPLOADING,
            }).lean()

            if (!story) {

                throw fail(ResponseCodes['404_NOT_FOUND'], 'Story not found')
            }

            helpers.validateUserHasAccessToWorkspace(authUser, String(story.workspaceId))

            const dir = desktopStoryDir(ENV.STORY_REQUESTS_FOLDER, storyId)

            if (!dir) {

                throw fail(ResponseCodes['400_BAD_REQUEST'], 'invalid desktop file')
            }

            await writeFileAtOffset(path.join(dir, name), body, offset)
            res.set(CORS_HEADERS)
            res.status(ResponseCodes['200_OK'])
            res.send(JSON.stringify({ ok: true }))
        })
        .catch((error) => {
            logger.error(error, { eventName: 'PUT_DESKTOP_STORY_FILE_FAILED' })
            const resultResponse = error.resultResponse || {
                statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
                headers: CORS_HEADERS,
                body: '',
            }
            res.set(resultResponse.headers)
            res.status(resultResponse.statusCode)
            res.send(resultResponse.body)
        })
}

export default handler
