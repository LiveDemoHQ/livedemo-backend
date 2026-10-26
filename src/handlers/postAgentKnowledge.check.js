// Self-check for importedChunks — run: node src/handlers/postAgentKnowledge.check.js
// Fails if imported chunks with the wrong embedding size get stored, or valid ones get mangled.
import assert from 'assert'
import { importedChunks } from './postAgentKnowledge.js'

import logger from '../helpers/logger.js'

const embedding = Array.from({ length: 768 }, (_, i) => i / 768)
const chunk = { text: 'hello', embedding, metadata: { title: 'Doc', url: 'https://a.com', demoId: 'x' } }

assert.deepEqual(importedChunks([chunk]), [{ text: 'hello', embedding, metadata: { title: 'Doc', url: 'https://a.com' } }])
assert.deepEqual(importedChunks(JSON.stringify([chunk]))[0].embedding, embedding)
assert.throws(() => importedChunks([{ ...chunk, embedding: embedding.slice(1) }]), /768-number embedding/)
assert.throws(() => importedChunks([{ ...chunk, embedding: [...embedding.slice(1), 'x'] }]), /768-number embedding/)
assert.throws(() => importedChunks([]), /chunks must be/)
assert.throws(() => importedChunks('{nope'), /chunks must be JSON/)

logger.info('postAgentKnowledge.check ok', { eventName: 'POSTAGENTKNOWLEDGE_CHECK_OK' })
