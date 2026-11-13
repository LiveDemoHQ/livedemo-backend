import fsp from 'fs/promises'
import path from 'path'

// Same ceiling as story import parts. A body over 100 MB is rejected before it reaches the API.
export const PART_BYTES = 70 * 1024 * 1024

const NAME_RE = /^(video\.mov|[A-Za-z0-9_-]{22}\.png)$/
const STORY_ID_RE = /^[a-fA-F0-9]{24}$/

export function safeDesktopFileName(name) {
    return NAME_RE.test(String(name || '')) ? String(name) : null
}

export function desktopStoryDir(folder, storyId) {
    if (!STORY_ID_RE.test(String(storyId || ''))) {

        return null
    }

    return path.join(folder, String(storyId))
}

export function desktopVideoPath(folder, storyId) {
    const dir = desktopStoryDir(folder, storyId)

    return dir ? path.join(dir, 'video.mov') : null
}

// r+, not a+. Linux O_APPEND ignores the write position, so a retried part would append.
export async function writeFileAtOffset(filePath, body, offset) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true })
    let handle

    try {

        handle = await fsp.open(filePath, 'r+')
    } catch (error) {

        if (error.code !== 'ENOENT') {

            throw error
        }

        handle = await fsp.open(filePath, 'w+')
    }

    try {

        await handle.write(body, 0, body.length, offset)
    } finally {

        await handle.close()
    }
}

export async function readDesktopScreenshots(folder, storyId) {
    const dir = desktopStoryDir(folder, storyId)

    if (!dir) {

        return []
    }

    let names

    try {

        names = await fsp.readdir(dir)
    } catch {

        return []
    }

    const pngs = names.filter((name) => name.endsWith('.png') && safeDesktopFileName(name)).sort()
    const shots = []

    for (const name of pngs) {

        shots.push({
            key: name.slice(0, -4),
            buffer: await fsp.readFile(path.join(dir, name))
        })
    }

    return shots
}

export async function removeDesktopStoryDir(folder, storyId) {
    const dir = desktopStoryDir(folder, storyId)

    if (!dir) {

        return
    }

    await fsp.rm(dir, { recursive: true, force: true })
}
