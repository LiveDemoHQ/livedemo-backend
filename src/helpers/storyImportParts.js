import fsp from 'fs/promises'
import os from 'os'
import path from 'path'

// Cloudflare rejects a request body over 100 MB. Each part stays under that.
export const PART_BYTES = 70 * 1024 * 1024
const SCREENDOC_ENCODING = 'utf-8'
const ROOT = path.join(os.tmpdir(), 'livedemo-story-import')

const remoteUrl = (value) => /^https?:\/\//i.test(value || '')

export function safeImportPath(value) {
    const rel = String(value || '').replace(/\\/g, '/')
    if (rel === 'story.json' || rel === 'assets.json') {
        return rel
    }
    if (/^screens\/[^/]+\.(json|png|mp4)$/.test(rel)) {
        return rel
    }
    if (/^assets\/[^/]+$/.test(rel) && !rel.includes('..')) {
        return rel
    }
    return null
}

export function safeImportId(value) {
    return /^[a-f0-9]{32}$/.test(String(value || '')) ? String(value) : null
}

const uploadDir = (userId, importId) => path.join(ROOT, String(userId), importId)

async function exists(file) {
    return fsp.access(file).then(() => true, () => false)
}

// Files the importer actually needs. Screenshots and videos already hosted at an https URL
// are left out: import keeps that URL and would ignore the bytes.
export async function importFolderFiles(folder) {
    const files = [{ rel: 'story.json', abs: path.join(folder, 'story.json') }]
    const dir = path.join(folder, 'screens')
    const names = (await fsp.readdir(dir)).filter((name) => name.endsWith('.json'))
    for (const name of names) {
        const abs = path.join(dir, name)
        files.push({ rel: `screens/${name}`, abs })
        const { screenDoc } = JSON.parse(await fsp.readFile(abs, SCREENDOC_ENCODING))
        const png = path.join(dir, name.replace(/\.json$/, '.png'))
        if (!remoteUrl(screenDoc.imageUrl) && await exists(png)) {
            files.push({ rel: `screens/${path.basename(png)}`, abs: png })
        }
        const mp4 = path.join(dir, name.replace(/\.json$/, '.mp4'))
        if (!screenDoc.asset && await exists(mp4)) {
            files.push({ rel: `screens/${path.basename(mp4)}`, abs: mp4 })
        }
    }
    const manifestPath = path.join(folder, 'assets.json')
    if (await exists(manifestPath)) {
        files.push({ rel: 'assets.json', abs: manifestPath })
        const manifest = JSON.parse(await fsp.readFile(manifestPath, SCREENDOC_ENCODING))
        for (const { file } of manifest) {
            const abs = path.join(folder, 'assets', file)
            const rel = safeImportPath(`assets/${file}`)
            if (rel && await exists(abs)) {
                files.push({ rel, abs })
            }
        }
    }
    return files
}

export async function readImportFolder(folder) {
    const story = JSON.parse(await fsp.readFile(path.join(folder, 'story.json'), SCREENDOC_ENCODING))
    const dir = path.join(folder, 'screens')
    const names = (await fsp.readdir(dir)).filter((name) => name.endsWith('.json'))
    const screens = []
    for (const name of names) {
        const { screenDoc, events } = JSON.parse(await fsp.readFile(path.join(dir, name), SCREENDOC_ENCODING))
        const png = path.join(dir, name.replace(/\.json$/, '.png'))
        const imageData = remoteUrl(screenDoc.imageUrl) ? '' : await fsp.readFile(png).then((buf) => buf.toString('base64'), () => '')
        const mp4 = path.join(dir, name.replace(/\.json$/, '.mp4'))
        const videoData = screenDoc.asset ? '' : await fsp.readFile(mp4).then((buf) => buf.toString('base64'), () => '')
        screens.push({ screenDoc, events, imageData, ...(videoData && { videoData }) })
    }
    const manifest = await fsp.readFile(path.join(folder, 'assets.json'), SCREENDOC_ENCODING).then(JSON.parse, () => [])
    const assets = []
    for (const { url, file, mimeType } of manifest) {
        const data = (await fsp.readFile(path.join(folder, 'assets', file))).toString('base64')
        assets.push({ url, mimeType, data })
    }
    return { story, screens, ...(assets.length && { assets }) }
}

export async function saveImportPart({ userId, importId, rel, part, parts, body }) {
    const dir = uploadDir(userId, importId)
    const partDir = path.join(dir, '.parts', encodeURIComponent(rel))
    await fsp.mkdir(partDir, { recursive: true })
    await fsp.writeFile(path.join(partDir, String(part)), body)
    await fsp.writeFile(path.join(partDir, 'count'), String(parts))
}

async function assemble(dir) {
    const partsRoot = path.join(dir, '.parts')
    if (!await exists(partsRoot)) {
        return
    }
    for (const encoded of await fsp.readdir(partsRoot)) {
        const rel = safeImportPath(decodeURIComponent(encoded))
        if (!rel) {
            throw new Error('invalid import path')
        }
        const partDir = path.join(partsRoot, encoded)
        const count = Number(await fsp.readFile(path.join(partDir, 'count'), SCREENDOC_ENCODING))
        const chunks = []
        for (let part = 0; part < count; part++) {
            chunks.push(await fsp.readFile(path.join(partDir, String(part))))
        }
        const dest = path.join(dir, rel)
        await fsp.mkdir(path.dirname(dest), { recursive: true })
        await fsp.writeFile(dest, Buffer.concat(chunks))
    }
    await fsp.rm(partsRoot, { recursive: true, force: true })
}

export async function finishImportFolder(userId, importId) {
    const dir = uploadDir(userId, importId)
    await assemble(dir)
    return { dir, payload: await readImportFolder(dir) }
}

export async function removeImportFolder(userId, importId) {
    await fsp.rm(uploadDir(userId, importId), { recursive: true, force: true })
}
