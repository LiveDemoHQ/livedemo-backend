// node src/helpers/storyImportParts.check.js
import assert from 'assert'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import {
    finishImportFolder,
    importFolderFiles,
    readImportFolder,
    removeImportFolder,
    safeImportId,
    safeImportPath,
    saveImportPart,
} from './storyImportParts.js'

assert.equal(safeImportPath('story.json'), 'story.json')
assert.equal(safeImportPath('screens/0_aaaaaaaaaaaaaaaaaaaaaaaa.json'), 'screens/0_aaaaaaaaaaaaaaaaaaaaaaaa.json')
assert.equal(safeImportPath('screens/../story.json'), null)
assert.equal(safeImportPath('/story.json'), null)
assert.equal(safeImportId('a'.repeat(32)), 'a'.repeat(32))
assert.equal(safeImportId('nope'), null)

const folder = await fsp.mkdtemp(path.join(os.tmpdir(), 'story-import-parts-'))
const screenId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
try {
    await fsp.mkdir(path.join(folder, 'screens'))
    await fsp.writeFile(path.join(folder, 'story.json'), JSON.stringify({
        name: 'Permiso',
        screens: [{ _id: screenId }],
    }))
    await fsp.writeFile(path.join(folder, 'screens', `0_${screenId}.json`), JSON.stringify({
        screenDoc: { _id: screenId, imageUrl: 'https://livedemo-cdn.s3.us-east-1.amazonaws.com/story-images/x.png' },
        events: [],
    }))
    await fsp.writeFile(path.join(folder, 'screens', `0_${screenId}.png`), Buffer.from('not-a-png'))

    const files = await importFolderFiles(folder)
    assert.deepEqual(files.map((file) => file.rel), ['story.json', `screens/0_${screenId}.json`])
    const payload = await readImportFolder(folder)
    assert.equal(payload.screens[0].imageData, '')
    assert.equal(payload.screens[0].screenDoc.imageUrl, 'https://livedemo-cdn.s3.us-east-1.amazonaws.com/story-images/x.png')

    const userId = 'user'
    const importId = 'b'.repeat(32)
    const story = await fsp.readFile(path.join(folder, 'story.json'))
    const mid = Math.ceil(story.length / 2)
    await saveImportPart({ userId, importId, rel: 'story.json', part: 1, parts: 2, body: story.subarray(mid) })
    await saveImportPart({ userId, importId, rel: 'story.json', part: 0, parts: 2, body: story.subarray(0, mid) })
    const screen = await fsp.readFile(path.join(folder, 'screens', `0_${screenId}.json`))
    await saveImportPart({ userId, importId, rel: `screens/0_${screenId}.json`, part: 0, parts: 1, body: screen })
    const assembled = await finishImportFolder(userId, importId)
    assert.equal(assembled.payload.story.name, 'Permiso')
    assert.equal(assembled.payload.screens[0].imageData, '')
    await removeImportFolder(userId, importId)
} finally {
    await fsp.rm(folder, { recursive: true, force: true })
}

console.log('story import parts checks passed')
