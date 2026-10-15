import mongoose from 'mongoose'
import fsp from 'fs/promises'
import ENV from '../envServer.js'
import ScreenTypes from '../constants/ScreenTypes.js'
import { stringifyRrwebEvents } from './rrwebEventNames.js'
import helpers from './livedemoHelpers.js'
import flixHelpers from './flixHelpers.js'

// Imports an exported story ({ story, screens: [{ screenDoc, events, imageData?, videoData? }] }, e.g. a livedemo-cursor output)
// as a new story in workspaceId. Recordings are written to this server's STORIES_FOLDER; imageData (base64 png)
// is uploaded when the screen has no imageUrl, videoData (base64 mp4) becomes a Mux asset when a Screen_Video has none,
// and payload.assets ([{ url, mimeType, data }]) are uploaded and their urls rewritten in every screen.
const { ObjectId } = mongoose.Types
const SCREENDOC_ENCODING = 'utf-8'
const RRWEB_FULL_SNAPSHOT = 2

function screenModelForType(Models, type) {
    if (type === ScreenTypes.SCREEN_PAGE) return Models.Screen_Page
    if (type === ScreenTypes.SCREEN_VIDEO) return Models.Screen_Video
    if (type === ScreenTypes.SCREEN_SCREENSHOT) return Models.Screen_Screenshot
    return Models.Screen
}

// Screen ids referenced inside steps/transitions must point at the new copies
function remapScreenRefs(screen, oldScreenIdToNewId) {
    const remap = (id) => (id != null && oldScreenIdToNewId[String(id)]) || id
    for (const step of screen.steps || []) {
        for (const button of (step.view && step.view.popup && step.view.popup.buttons) || []) {
            button.gotoScreen = remap(button.gotoScreen)
        }
    }
    for (const transition of screen.customTransitions || []) {
        transition.gotoScreen = remap(transition.gotoScreen)
    }
}

// Returns a message when the payload can't be imported, null when it's fine
export function importPayloadIssue({ story, screens } = {}) {
    if (!story || !Array.isArray(story.screens) || !story.screens.length) {
        return 'story.screens must be a non-empty array'
    }
    const byId = Object.fromEntries((screens || []).map((screen) => [String(screen?.screenDoc?._id), screen]))
    for (const storyScreen of story.screens) {
        const screen = byId[String(storyScreen._id)]
        if (!screen) {
            return `screen ${storyScreen._id} missing from screens`
        }
        const { recordingRole, baseScreenId } = screen.screenDoc
        if (!recordingRole) {
            continue
        }
        if (!Array.isArray(screen.events) || !screen.events.length) {
            return `screen ${storyScreen._id}: events must be a non-empty array`
        }
        if (recordingRole === 'base' && screen.events.filter((e) => e && e.type === RRWEB_FULL_SNAPSHOT).length !== 1) {
            return `screen ${storyScreen._id}: base events must contain exactly one FullSnapshot (type 2)`
        }
        if (recordingRole === 'delta' && byId[String(baseScreenId)]?.screenDoc.recordingRole !== 'base') {
            return `screen ${storyScreen._id}: baseScreenId must reference a base screen in this import`
        }
    }
    return null
}

export async function importStoryDemo(Models, payload, { workspaceId, userId }) {
    const issue = importPayloadIssue(payload)
    if (issue) {
        throw new Error(issue)
    }
    if (!ENV.STORIES_FOLDER) {
        throw new Error('STORIES_FOLDER env is required to import Screen_Page files')
    }

    const screens = [...payload.story.screens].sort((a, b) => (a.index || 0) - (b.index || 0))
    const newStoryId = new ObjectId()
    const storyDir = `${ENV.STORIES_FOLDER}/${newStoryId}`

    try {
        await fsp.mkdir(storyDir, { recursive: true })

        // assets ([{ url, mimeType, data }], e.g. a scraped page's images/fonts) are re-hosted, then every url in the screens is swapped
        let screensJson = JSON.stringify(payload.screens)
        for (const [i, asset] of (payload.assets || []).entries()) {
            const uploaded = await helpers.uploadBufferImage(Buffer.from(asset.data, 'base64'), asset.mimeType, `${newStoryId}-asset-${i}`)
            screensJson = screensJson.split(asset.url).join(uploaded.Location)
        }
        const screenFiles = Object.fromEntries(JSON.parse(screensJson).map((screen) => [String(screen.screenDoc._id), screen]))

        // Assign new screen ids first so delta baseScreenId / gotoScreen can remap in one pass
        const oldScreenIdToNewId = {}
        screens.forEach((screen) => { oldScreenIdToNewId[String(screen._id)] = new ObjectId() })

        const screensArray = []
        for (const storyScreen of screens) {
            const oldScreenId = String(storyScreen._id)
            const file = screenFiles[oldScreenId]
            const newScreenId = oldScreenIdToNewId[oldScreenId]
            const {
                storyId: _storyId, userId: _userId, workspaceId: _workspaceId,
                snapshotPath: _snapshotPath, eventsPath: _eventsPath, contentPath: _contentPath,
                __v, createdAt, updatedAt, ...screen
            } = file.screenDoc
            screen._id = newScreenId
            remapScreenRefs(screen, oldScreenIdToNewId)

            if (screen.recordingRole) {
                const fileName = screen.recordingRole === 'base' ? `${newScreenId}.rrweb.json` : `${newScreenId}.events.json`
                const filePath = `${storyDir}/${fileName}`
                await fsp.writeFile(filePath, stringifyRrwebEvents(file.events || []), { encoding: SCREENDOC_ENCODING })
                if (screen.recordingRole === 'base') {
                    screen.snapshotPath = filePath
                    delete screen.baseScreenId
                } else {
                    screen.eventsPath = filePath
                    screen.baseScreenId = oldScreenIdToNewId[String(screen.baseScreenId)]
                }
            }

            // Rendered screens (livedemo-cursor) ship a PNG but no imageUrl
            if (!screen.imageUrl && file.imageData) {
                const uploaded = await helpers.uploadImage(file.imageData, `${newScreenId}.png`)
                screen.imageUrl = uploaded.Location
            }
            if (screen.type === ScreenTypes.SCREEN_VIDEO && !screen.asset && file.videoData) {
                screen.asset = await flixHelpers.uploadMuxVideo(file.videoData)
            }
            for (const step of screen.steps || []) {
                const popup = step.view && step.view.popup
                if (popup && popup.showPreviewImage && !popup.previewImageUrl) {
                    popup.previewImageUrl = screen.imageUrl || ''
                }
            }

            const ScreenModel = screenModelForType(Models, screen.type)
            const saved = await new ScreenModel({
                ...screen,
                storyId: newStoryId,
                userId,
                workspaceId,
                cursorPositions: [],
            }).save()
            screensArray.push(saved)
        }

        const {
            _id: _oldStoryId,
            cursorPositions: _cursorPositions,
            screens: _screens,
            __v, createdAt, updatedAt,
            ...storyFields
        } = payload.story

        await new Models.Story({
            ...storyFields,
            _id: newStoryId,
            userId,
            workspaceId,
            filePath: undefined,
            deletedAt: null,
            thumbnailImageUrl: storyFields.thumbnailImageUrl || (screensArray[0] && screensArray[0].imageUrl) || '',
            screens: screensArray.map(scr => scr._id),
        }).save()
    } catch (err) {
        // Don't leave a half-imported story behind
        await Models.Screen.deleteMany({ storyId: newStoryId })
        await fsp.rm(storyDir, { recursive: true, force: true })
        throw err
    }
    return newStoryId
}

export default {
    importPayloadIssue,
    importStoryDemo,
}
