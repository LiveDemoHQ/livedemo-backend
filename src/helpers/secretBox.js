import crypto from 'crypto'
import ENV from '../envServer.js'

// AES-256-GCM for workspace secrets at rest (SMTP password, provider API keys).
// The key is derived per purpose; `aad` (e.g. the workspace id) binds a ciphertext to its owner,
// so a value copied into another workspace fails to decrypt. Rotating PRIVATE_AUTH_TOKEN invalidates stored secrets.

const keyFor = (purpose) => {
    if (!ENV.PRIVATE_AUTH_TOKEN) throw new Error('PRIVATE_AUTH_TOKEN is required to store secrets')
    return crypto.createHash('sha256').update(`${purpose}:${ENV.PRIVATE_AUTH_TOKEN}`).digest()
}

export function seal(plain, purpose, aad = '') {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(purpose), iv)
    cipher.setAAD(Buffer.from(String(aad)))
    const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64')).join('.')
}

export function open(stored, purpose, aad = '') {
    const [iv, tag, data] = String(stored || '').split('.').map(s => Buffer.from(s, 'base64'))
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(purpose), iv)
    decipher.setAAD(Buffer.from(String(aad)))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
