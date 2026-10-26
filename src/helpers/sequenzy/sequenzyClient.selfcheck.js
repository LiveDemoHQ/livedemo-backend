import crypto from 'crypto'
import { verifyWebhookSignature } from './sequenzyClient.js'

import logger from '../logger.js'

const secret = 'whsec_test'
const body = '{"type":"subscriber.unsubscribed","data":{"email":"a@b.com"}}'
const ts = '1777977600'
const good = crypto.createHmac('sha256', secret).update(`v1:${ts}:${body}`).digest('hex')

if (!verifyWebhookSignature(body, ts, `v1=${good}`, secret)) throw new Error('valid signature rejected')
if (verifyWebhookSignature(body, ts, 'v1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', secret)) {
  throw new Error('invalid signature accepted')
}
if (verifyWebhookSignature(body, '0', `v1=${good}`, secret)) throw new Error('wrong timestamp accepted')
logger.info('sequenzyClient.selfcheck: ok', { eventName: 'SEQUENZYCLIENT_SELFCHECK_OK' })
