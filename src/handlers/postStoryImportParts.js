import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { importStoryDemo, importPayloadIssue } from '../helpers/importStoryDemo.js'
import postStoryImportValidator from '../helpers/validators/stories/postStoryImportValidator.js'
import {
    PART_BYTES,
    finishImportFolder,
    removeImportFolder,
    safeImportId,
    safeImportPath,
    saveImportPart,
} from '../helpers/storyImportParts.js'
import logger from '../helpers/logger.js'

const CORS_HEADERS = {
    'Access-Control-Max-Age': 600,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept,X-Import-Id,X-Import-Path,X-Import-Part,X-Import-Parts',
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

function partHeaders(req) {
    const importId = safeImportId(req.get('X-Import-Id'))
    const rel = safeImportPath(decodeURIComponent(req.get('X-Import-Path') || ''))
    const part = Number(req.get('X-Import-Part'))
    const parts = Number(req.get('X-Import-Parts'))
    if (!importId || !rel || !Number.isInteger(part) || !Number.isInteger(parts) || parts < 1 || part < 0 || part >= parts) {
        throw fail(ResponseCodes['400_BAD_REQUEST'], 'invalid import part')
    }
    return { importId, rel, part, parts }
}

async function authorize(req) {
    const { Models } = req.mongo
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, req.params.workspaceId)
    return { Models, authUser }
}

// POST /workspaces/:workspaceId/stories/import-part
// One slice of a story folder file. Headers: X-Import-Id, X-Import-Path, X-Import-Part, X-Import-Parts.
const postStoryImportPart = function (req, res) {
    return Promise.resolve()
        .then(async () => {
            const { authUser } = await authorize(req)
            const { importId, rel, part, parts } = partHeaders(req)
            const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
            if (body.length > PART_BYTES) {
                throw fail(ResponseCodes['400_BAD_REQUEST'], 'import part is too large')
            }
            await saveImportPart({
                userId: authUser._id,
                importId,
                rel,
                part,
                parts,
                body,
            })
            res.set(CORS_HEADERS)
            res.status(ResponseCodes['200_OK'])
            res.send(JSON.stringify({ ok: true }))
        })
        .catch((error) => {
            logger.error(error, { eventName: 'POST_STORY_IMPORT_PART_FAILED' })
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

// POST /workspaces/:workspaceId/stories/import-finish { importId }
// Puts the parts back into a story folder and imports it.
const postStoryImportFinish = function (req, res) {
    const workspaceId = req.params.workspaceId
    let importId = ''
    let userId = ''
    return Promise.resolve()
        .then(async () => {
            const { Models, authUser } = await authorize(req)
            importId = safeImportId(req.body && req.body.importId)
            userId = String(authUser._id)
            if (!importId) {
                throw fail(ResponseCodes['400_BAD_REQUEST'], 'invalid import id')
            }
            const { payload } = await finishImportFolder(userId, importId)
            const body = helpers.validateBody(payload, postStoryImportValidator).value
            const issue = importPayloadIssue(body)
            if (issue) {
                throw fail(ResponseCodes['400_BAD_REQUEST'], issue)
            }
            const newStoryId = await importStoryDemo(Models, body, { workspaceId, userId: authUser._id })
            return Models.Story.findById(newStoryId)
                .populate({ path: 'screens', select: '_id type imageUrl' })
                .lean()
        })
        .then(async (story) => {
            res.set(CORS_HEADERS)
            res.status(ResponseCodes['200_OK'])
            res.send(JSON.stringify(story))
            await removeImportFolder(userId, importId)
        })
        .catch(async (error) => {
            if (userId && importId) {
                await removeImportFolder(userId, importId)
            }
            if (res.headersSent) {
                return
            }
            logger.error(error, { eventName: 'POST_STORY_IMPORT_FINISH_FAILED' })
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

export { postStoryImportPart, postStoryImportFinish }
