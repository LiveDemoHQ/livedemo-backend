/**
 * ponytail: assert-based self-check for access-log helpers + error stacks.
 * Run: node src/helpers/logger.check.js
 */
import assert from 'assert'
import {
    summarizeAuthorization,
    truncateReqBody
} from '../middlewares/httpAccessLog.js'
import logger from './logger.js'


assert.deepStrictEqual(
    summarizeAuthorization(undefined),
    { present: false }
)
assert.deepStrictEqual(
    summarizeAuthorization('Bearer abcdefgh'),
    { scheme: 'Bearer', present: true, len: 8 }
)

assert.equal(truncateReqBody({ name: 'ok' }), '{"name":"ok"}')
assert.equal(
    truncateReqBody({ password: 'secret', name: 'x' }),
    '{"password":"[REDACTED]","name":"x"}'
)
assert.equal(truncateReqBody('<html>nope</html>'), undefined)
assert.equal(truncateReqBody(Buffer.from('bin')), undefined)

const long = 'a'.repeat(300)
const truncated = truncateReqBody(long)
assert.ok(truncated.startsWith('a'.repeat(256)))
assert.ok(truncated.includes('totalChars=300'))

let errorOut = ''
const origWrite = process.stderr.write
process.stderr.write = (chunk, ...rest) => {

    errorOut += String(chunk)
    return true
}
try {

    logger.error('stack check', { eventName: 'OWN_CLAIM_FAILED' })
} finally {

    process.stderr.write = origWrite
}
assert.ok(errorOut.includes('"stack"'), 'error log must include stack')
assert.ok(errorOut.includes('Error'), 'stack must look like Error().stack')

logger.info('logger.check.js: ok', { eventName: 'LOGGER' })
