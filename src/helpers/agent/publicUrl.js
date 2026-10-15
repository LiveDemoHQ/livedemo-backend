import dns from 'dns/promises'
import net from 'net'

// Author-supplied URLs (crawl roots, webhook targets) are fetched server-side,
// so they must resolve to the public internet only — never the VPC, metadata
// endpoints or localhost.

function isPrivateIp(ip) {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number)
        return a === 10 || a === 127 || a === 0
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 100 && b >= 64 && b <= 127)
            || a >= 224
    }
    const v6 = ip.toLowerCase()
    if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7))
    return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')
}

// Returns the parsed URL or throws. httpsOnly for webhooks.
// ponytail: resolve-then-fetch leaves a DNS-rebinding window; pin the resolved IP
// in a custom agent `lookup` if this ever guards something more sensitive.
export async function assertPublicUrl(raw, { httpsOnly = false } = {}) {
    let url
    try {
        url = new URL(String(raw || '').trim())
    } catch {
        throw new Error('Not a valid URL')
    }
    const protocols = httpsOnly ? ['https:'] : ['http:', 'https:']
    if (!protocols.includes(url.protocol)) throw new Error(httpsOnly ? 'URL must use https' : 'URL must use http or https')
    if (url.username || url.password) throw new Error('URL must not contain credentials')

    const host = url.hostname.replace(/^\[|\]$/g, '')
    const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map(a => a.address)
    if (!addresses.length || addresses.some(isPrivateIp)) throw new Error('URL must point to a public host')
    return url
}

export { isPrivateIp }
