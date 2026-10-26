// node src/handlers/oauth.check.js
import assert from 'assert'
import crypto from 'crypto'
import { isValidRedirectUri, pkceMatches } from './oauth.js'
import { newApiToken } from './apiKeys.js'
import { API_TOKEN_RE } from '../helpers/authHelpers.js'

import logger from '../helpers/logger.js'

assert.ok(isValidRedirectUri('https://claude.ai/api/mcp/auth_callback'))
assert.ok(isValidRedirectUri('http://localhost:6274/oauth/callback'))
assert.ok(isValidRedirectUri('http://127.0.0.1:33418/cb'))
assert.ok(!isValidRedirectUri('http://evil.com/cb'))
assert.ok(!isValidRedirectUri('javascript:alert(1)'))
assert.ok(!isValidRedirectUri('https://claude.ai/cb#frag'))
assert.ok(!isValidRedirectUri('not a url'))

const verifier = crypto.randomBytes(32).toString('base64url')
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
assert.ok(pkceMatches(verifier, challenge))
assert.ok(!pkceMatches(verifier + 'x', challenge))
assert.ok(!pkceMatches('short', crypto.createHash('sha256').update('short').digest('base64url')))
assert.ok(!pkceMatches(undefined, challenge))

assert.ok(API_TOKEN_RE.test(newApiToken('live')))
assert.ok(API_TOKEN_RE.test(newApiToken('oat')))
assert.ok(!API_TOKEN_RE.test('ld_ort_abcdefghijklmnopqrstuvwxyz'))
assert.ok(!API_TOKEN_RE.test(crypto.randomBytes(32).toString('hex')))

logger.info('oauth.check ok', { eventName: 'OAUTH_CHECK_OK' })
process.exit(0)
