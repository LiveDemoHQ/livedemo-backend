import dns from 'dns/promises'
import net from 'net'
import nodemailer from 'nodemailer'
import { seal, open } from '../secretBox.js'
import { sendRawEmail } from '../emails/emailsSender.js'
import { isPrivateIp } from './publicUrl.js'

// Workspace-level sender for visitor emails (session summaries), stored on Workspace.summaryEmailSending:
// disabled (default) | livedemo (support@livedemo.ai over SES) | smtp (the workspace's own server).
// The SMTP password is AES-256-GCM encrypted at rest and never returned to the client.

export const MODES = ['disabled', 'livedemo', 'smtp']
export const SMTP_PORTS = [25, 465, 587, 2525]
export const LIVEDEMO_FROM = 'support@livedemo.ai'

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i
const validation = message => Object.assign(new Error(message), { isValidation: true })
const cleanName = value => String(value || '').replace(/[\r\n"<>]/g, '').trim().slice(0, 60)

export const encryptSecret = plain => seal(plain, 'smtp-password')
export const decryptSecret = stored => open(stored, 'smtp-password')

export function emailSettingsOf(workspace) {
    const settings = (workspace && workspace.summaryEmailSending) || {}
    return { mode: MODES.includes(settings.mode) ? settings.mode : 'disabled', smtp: settings.smtp || {} }
}

export function publicEmailSettings(workspace) {
    const { mode, smtp } = emailSettingsOf(workspace)
    return {
        mode,
        smtp: {
            host: smtp.host || '',
            port: smtp.port || 587,
            user: smtp.user || '',
            hasPassword: !!smtp.passEnc,
            fromEmail: smtp.fromEmail || '',
            fromName: smtp.fromName || '',
            replyTo: smtp.replyTo || ''
        },
        livedemoFrom: LIVEDEMO_FROM
    }
}

// Validates a PUT body against the stored settings. A blank password keeps the stored one.
export function normalizeEmailSettings(body, workspace) {
    const mode = body && body.mode
    if (!MODES.includes(mode)) throw validation(`mode must be one of: ${MODES.join(', ')}`)
    const current = emailSettingsOf(workspace).smtp
    if (mode !== 'smtp') return { mode, smtp: current }

    const input = body.smtp || {}
    const host = String(input.host || '').trim().toLowerCase()
    const port = Number(input.port)
    const user = String(input.user || '').trim()
    const fromEmail = String(input.fromEmail || '').trim().toLowerCase()
    const replyTo = String(input.replyTo || '').trim().toLowerCase()
    if (!HOST_RE.test(host) || host.length > 253) throw validation('SMTP host must be a hostname such as smtp.example.com')
    if (!SMTP_PORTS.includes(port)) throw validation(`SMTP port must be one of: ${SMTP_PORTS.join(', ')}`)
    if (user.length > 200 || /[\r\n]/.test(user)) throw validation('SMTP username is invalid')
    if (!EMAIL_RE.test(fromEmail)) throw validation('From email is invalid')
    if (replyTo && !EMAIL_RE.test(replyTo)) throw validation('Reply-to email is invalid')

    const password = String(input.password || '')
    if (password.length > 500) throw validation('SMTP password is too long')
    const passEnc = password ? encryptSecret(password) : current.passEnc
    if (user && !passEnc) throw validation('SMTP password is required')

    return {
        mode,
        smtp: {
            host,
            port,
            user,
            passEnc: passEnc || '',
            fromEmail,
            fromName: cleanName(input.fromName),
            replyTo
        }
    }
}

// Resolve once and connect to that IP so a DNS change can't point us at an internal host
async function resolvePublicHost(host) {
    const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map(a => a.address)
    if (!addresses.length || addresses.some(isPrivateIp)) throw new Error('SMTP host must be a public server')
    return addresses[0]
}

// From/Reply-To for a message; null when sending is disabled
export function senderFor(settings, displayName) {
    if (settings.mode === 'smtp') {
        const smtp = settings.smtp
        return { name: cleanName(smtp.fromName) || cleanName(displayName), email: smtp.fromEmail, replyTo: smtp.replyTo || '' }
    }
    if (settings.mode === 'livedemo') return { name: `${cleanName(displayName) || 'Demo agent'} via LiveDemo`, email: LIVEDEMO_FROM, replyTo: '' }
    return null
}

// Sends a full MIME message; resolves to a message id
export async function deliver(settings, { to, mime }) {
    if (settings.mode === 'livedemo') return sendRawEmail(mime)
    if (settings.mode !== 'smtp') throw new Error('Email sending is disabled for this workspace')

    const smtp = settings.smtp
    const transport = nodemailer.createTransport({
        host: await resolvePublicHost(smtp.host),
        port: smtp.port,
        secure: smtp.port === 465,
        requireTLS: smtp.port !== 465 && smtp.port !== 25,
        tls: { servername: smtp.host },
        auth: smtp.user ? { user: smtp.user, pass: decryptSecret(smtp.passEnc) } : undefined,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000
    })
    const info = await transport.sendMail({ envelope: { from: smtp.fromEmail, to: [to] }, raw: mime })
    return info.messageId || ''
}
