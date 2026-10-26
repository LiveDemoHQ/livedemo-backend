import assert from 'assert'
import {

  updateTextInSnapshot,
  applyAttrsToSnapshot,
  mergeStyleString,
  findFirstTextNodeId,
  upsertTextMutationAt,
} from './editRrwebScreenText.js'
import logger from './logger.js'

const snap = [{
  type: 2,
  data: {
    node: {
      type: 2,
      id: 1,
      tagName: 'div',
      attributes: { style: 'color: red' },
      childNodes: [
        { type: 3, id: 2, textContent: 'hello' },
        { type: 2, id: 3, tagName: 'img', attributes: { src: 'old.png', rr_dataURL: 'data:image/png;base64,xxx', srcset: 'old.png 1x' }, childNodes: [] },
      ],
    },
  },
}]

assert.strictEqual(
  mergeStyleString('color: red', { 'background-color': 'blue' }),
  'color: red; background-color: blue',
)
assert.strictEqual(
  mergeStyleString('color: red; visibility: hidden', { visibility: '' }),
  'color: red',
)
assert.strictEqual(
  mergeStyleString('color: red', { filter: 'blur(8px)' }),
  'color: red; filter: blur(8px)',
)
assert.strictEqual(
  mergeStyleString('color: red; filter: blur(8px)', { filter: '' }),
  'color: red',
)

assert.strictEqual(findFirstTextNodeId(snap, 1), 2)
assert.strictEqual(findFirstTextNodeId(snap, '1'), 2)
assert.ok(updateTextInSnapshot(snap, 2, 'bye'))
assert.strictEqual(snap[0].data.node.childNodes[0].textContent, 'bye')

assert.ok(applyAttrsToSnapshot(snap, 1, null, { color: '#111111', 'background-color': '#fff' }))
assert.ok(snap[0].data.node.attributes.style.includes('color: #111111'))
assert.ok(snap[0].data.node.attributes.style.includes('background-color: #fff'))

assert.ok(applyAttrsToSnapshot(snap, 3, { src: 'new.png', srcset: '', rr_dataURL: 'new.png' }, null))
assert.strictEqual(snap[0].data.node.childNodes[1].attributes.src, 'new.png')
assert.strictEqual(snap[0].data.node.childNodes[1].attributes.srcset, undefined)
assert.strictEqual(snap[0].data.node.childNodes[1].attributes.rr_dataURL, undefined)

const deltaEvents = [
  { type: 3, timestamp: 100, data: { source: 0, texts: [], attributes: [], removes: [], adds: [] } },
  { type: 3, timestamp: 200, data: { source: 2, type: 2 } },
]
upsertTextMutationAt(deltaEvents, 2, 'Create New Test best', 200)
const applied = deltaEvents.filter((ev) => ev.timestamp <= 200)
const textMut = applied.find((ev) => ev.data && ev.data.texts && ev.data.texts.some((t) => t.id === 2 && t.value === 'Create New Test best'))
assert.ok(textMut, 'delta text mutation must be at toTimeMs so seek applies it')
assert.ok(!deltaEvents.some((ev) => ev.timestamp > 200 && ev.data && ev.data.texts && ev.data.texts.length), 'must not append after toTimeMs')

logger.info('editRrwebScreenText.check ok', { eventName: 'EDITRRWEBSCREENTEXT_CHECK_OK' })
