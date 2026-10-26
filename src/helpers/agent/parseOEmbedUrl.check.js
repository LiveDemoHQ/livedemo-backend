import assert from 'assert'
import { parseOEmbedUrl } from './parseOEmbedUrl.js'

import logger from '../logger.js'

const api = 'http://localhost.mine:3005'
const app = 'http://localhost.mine:5000'
const origins = [api, app]

assert.deepStrictEqual(
  parseOEmbedUrl(`${api}/workspaces/ws1/stories/st1/preview?step=1`, origins),
  { kind: 'story', workspaceId: 'ws1', id: 'st1' },
)
assert.deepStrictEqual(
  parseOEmbedUrl(`${api}/workspaces/ws1/agents/ag1/preview`, origins),
  { kind: 'agent', workspaceId: 'ws1', id: 'ag1' },
)
assert.deepStrictEqual(
  parseOEmbedUrl(`${api}/agents/ag1/preview`, origins),
  { kind: 'agent', id: 'ag1' },
)
assert.deepStrictEqual(
  parseOEmbedUrl(`${app}/agents/ag1`, origins),
  { kind: 'agent', id: 'ag1' },
)
assert.deepStrictEqual(
  parseOEmbedUrl(`${api}/livedemos/st1`, origins),
  { kind: 'story', id: 'st1' },
)
assert.strictEqual(parseOEmbedUrl('https://evil.example/workspaces/ws/stories/st/preview', origins), null)
assert.strictEqual(parseOEmbedUrl('', origins), null)
assert.strictEqual(parseOEmbedUrl('not-a-url', origins), null)

logger.info('parseOEmbedUrl.check.js: all assertions passed', { eventName: 'PARSEOEMBEDURL_CHECK_JS_ALL_ASSERTIONS_PASSED' })
