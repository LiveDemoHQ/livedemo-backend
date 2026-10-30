import { createRequire } from 'module'
import dns from 'dns'

const require = createRequire(import.meta.url)

// Maintained open list (npm: disposable-email-domains) plus domains seen in our own spam
const LOCAL_BLOCKED = []
// Never block these, even if a list contains them
const ALLOWED = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com', 'gmx.com', 'zoho.com']

const blocked = new Set([...require('disposable-email-domains'), ...LOCAL_BLOCKED].map((d) => d.toLowerCase()))
const allowed = new Set(ALLOWED)

export const DISPOSABLE_EMAIL_MESSAGE = 'Please use a permanent email address. Temporary inboxes can\'t be used to sign up.'

function domainOf(email) {
  const at = typeof email === 'string' ? email.lastIndexOf('@') : -1
  return at === -1 ? '' : email.slice(at + 1).trim().toLowerCase()
}

// a.b.mailinator.com -> checks a.b.mailinator.com, b.mailinator.com, mailinator.com
export function isDisposableEmail(email) {
  const parts = domainOf(email).split('.').filter(Boolean)
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.')
    if (allowed.has(candidate)) return false
    if (blocked.has(candidate)) return true
  }
  return false
}

// true when the domain definitely cannot receive mail. DNS errors/timeouts let the signup through.
export async function emailDomainHasNoMail(email, timeoutMs = 2000) {
  const domain = domainOf(email)
  if (!domain) return true
  const lookup = dns.promises.resolveMx(domain).then(
    (records) => records.length === 0,
    (err) => err && (err.code === 'ENOTFOUND' || err.code === 'ENODATA')
  )
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
  return Promise.race([lookup, timeout])
}

// Simple per-process sliding window; enough to slow scripts, a shared limiter is better behind many pods
const hits = new Map()
export function signupRateLimited(ip, { max = 5, windowMs = 60 * 60 * 1000 } = {}) {
  if (!ip) return false
  const now = Date.now()
  const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs)
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 10000) {
    for (const [key, times] of hits) if (!times.some((t) => now - t < windowMs)) hits.delete(key)
  }
  return recent.length > max
}
