// node src/helpers/desktopStoryFiles.check.js
import assert from 'assert'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import {
    desktopVideoPath,
    readDesktopScreenshots,
    removeDesktopStoryDir,
    safeDesktopFileName,
    writeFileAtOffset,
} from './desktopStoryFiles.js'

assert.equal(safeDesktopFileName('video.mov'), 'video.mov')
assert.equal(safeDesktopFileName('abcdefghijklmnopqrstuv.png'), 'abcdefghijklmnopqrstuv.png')
assert.equal(safeDesktopFileName('../video.mov'), null)
assert.equal(safeDesktopFileName('short.png'), null)
assert.equal(safeDesktopFileName('video.mov.png'), null)

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'desktop-story-'))
const storyId = 'a'.repeat(24)
const video = desktopVideoPath(root, storyId)

try {
    await writeFileAtOffset(video, Buffer.from('hello '), 0)
    await writeFileAtOffset(video, Buffer.from('world'), 6)
    await writeFileAtOffset(video, Buffer.from('HELLO'), 0)
    assert.equal(await fsp.readFile(video, 'utf8'), 'HELLO world')

    const png = path.join(root, storyId, `${'b'.repeat(22)}.png`)
    await writeFileAtOffset(png, Buffer.from('png'), 0)
    const shots = await readDesktopScreenshots(root, storyId)
    assert.equal(shots.length, 1)
    assert.equal(shots[0].key, 'b'.repeat(22))
    assert.equal(shots[0].buffer.toString(), 'png')

    await removeDesktopStoryDir(root, storyId)
    await assert.rejects(fsp.access(path.join(root, storyId)))
} finally {
    await fsp.rm(root, { recursive: true, force: true })
}

console.log('desktopStoryFiles.check ok')
