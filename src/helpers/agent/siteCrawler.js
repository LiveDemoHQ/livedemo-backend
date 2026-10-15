import crypto from 'crypto'
import axios from 'axios'
import { assertPublicUrl } from './publicUrl.js'

// Renders pages in headless Chrome (JS runs, so SPAs work), strips boilerplate,
// keeps headings / lists / tables / alt text as markdown. Reads sitemap.xml
// first, otherwise follows same-origin links. Never clicks or scrolls.

const PAGE_TIMEOUT_MS = 25000
const SETTLE_MS = 800
export const MAX_PAGES_CAP = 100

// Runs inside the page (page.evaluate) and in jsdom (siteCrawler.check.js):
// must stay self-contained — no imports, no closure variables.
export function domToMarkdown(doc) {
    const DROP = 'script, style, noscript, template, svg, canvas, iframe, nav, footer, aside, form, body > header, [role="navigation"], [role="banner"], [role="contentinfo"], [role="dialog"], [aria-modal="true"], [aria-hidden="true"], [hidden]'
    const root = (doc.querySelector('main, [role="main"], article') || doc.body).cloneNode(true)
    root.querySelectorAll(DROP).forEach(node => node.remove())

    const clean = text => String(text || '').replace(/\s+/g, ' ').trim()
    const out = []

    function inline(node) {
        if (node.nodeType === 3) return node.textContent
        if (node.nodeType !== 1) return ''
        const tag = node.tagName.toLowerCase()
        if (tag === 'img') return node.getAttribute('alt') ? ` [Image: ${clean(node.getAttribute('alt'))}] ` : ''
        if (tag === 'br') return ' '
        return Array.from(node.childNodes).map(inline).join('')
    }

    function table(node) {
        const rows = Array.from(node.querySelectorAll('tr')).map(tr => Array.from(tr.children).map(cell => clean(inline(cell)).replace(/\|/g, '/')))
        if (!rows.length) return
        const width = Math.max(...rows.map(r => r.length))
        const pad = r => [...r, ...Array(width - r.length).fill('')]
        const caption = node.querySelector('caption')
        if (caption) out.push(clean(caption.textContent))
        out.push(`| ${pad(rows[0]).join(' | ')} |`, `|${' --- |'.repeat(width)}`)
        rows.slice(1).forEach(r => out.push(`| ${pad(r).join(' | ')} |`))
        out.push('')
    }

    function walk(node) {
        if (node.nodeType !== 1) return
        const tag = node.tagName.toLowerCase()
        const heading = tag.match(/^h([1-6])$/)
        if (heading) {
            const text = clean(inline(node))
            if (text) out.push('', `${'#'.repeat(Math.min(Number(heading[1]), 4))} ${text}`, '')
            return
        }
        if (tag === 'table') return table(node)
        if (tag === 'li') {
            const text = clean(inline(node))
            if (text) out.push(`- ${text}`)
            return
        }
        if (tag === 'p' || tag === 'blockquote' || tag === 'pre' || tag === 'dt' || tag === 'dd' || tag === 'figcaption') {
            const text = clean(inline(node))
            if (text) out.push(text, '')
            return
        }
        if (tag === 'img') {
            const text = clean(inline(node))
            if (text) out.push(text, '')
            return
        }
        const blockChildren = Array.from(node.children).length
        if (!blockChildren) {
            const text = clean(node.textContent)
            if (text) out.push(text, '')
            return
        }
        Array.from(node.childNodes).forEach((child) => {
            if (child.nodeType === 3 && clean(child.textContent)) out.push(clean(child.textContent))
            else walk(child)
        })
    }

    walk(root)
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function contentHash(text) {
    return crypto.createHash('sha1').update(String(text || '')).digest('hex')
}

// Same origin, no fragments, no obvious non-HTML files
export function normalizeLink(href, origin) {
    let url
    try {
        url = new URL(href, origin)
    } catch {
        return null
    }
    if (url.origin !== origin) return null
    if (/\.(pdf|png|jpe?g|gif|svg|webp|zip|mp4|mp3|css|js|xml|json)$/i.test(url.pathname)) return null
    url.hash = ''
    return url.toString().replace(/\/$/, '') || origin
}

async function sitemapUrls(root, limit) {
    try {
        const res = await axios.get(new URL('/sitemap.xml', root).toString(), { timeout: 10000, maxContentLength: 5 * 1024 * 1024, maxRedirects: 2 })
        const locs = Array.from(String(res.data).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)).map(m => m[1])
        const pages = locs.filter(u => !/\.xml$/i.test(u)).map(u => normalizeLink(u, root.origin)).filter(Boolean)
        return [...new Set(pages)].slice(0, limit)
    } catch {
        return []
    }
}

async function launch() {
    const { default: puppeteer } = await import('puppeteer')
    return puppeteer.launch({
        executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage']
    })
}

async function renderPage(browser, url) {
    const page = await browser.newPage()
    try {
        // Redirects / sub-navigations to private hosts are refused, not just the first URL
        await page.setRequestInterception(true)
        page.on('request', (request) => {
            if (!request.isNavigationRequest()) {
                return ['image', 'media', 'font'].includes(request.resourceType()) ? request.abort() : request.continue()
            }
            assertPublicUrl(request.url()).then(() => request.continue(), () => request.abort())
        })
        await page.setUserAgent('Mozilla/5.0 (compatible; LiveDemoBot/1.0; +https://livedemo.ai)')
        await page.goto(url, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT_MS })
        await new Promise(resolve => setTimeout(resolve, SETTLE_MS))
        const [title, markdown, links] = await Promise.all([
            page.title(),
            page.evaluate(`(${domToMarkdown.toString()})(document)`),
            page.$$eval('a[href]', anchors => anchors.map(a => a.href))
        ])
        return { url, title: String(title || '').slice(0, 200), markdown, links }
    } finally {
        await page.close().catch(() => {})
    }
}

// One page (knowledge type 'url'). Falls back to plain fetch-and-strip when Chrome is missing.
export async function renderOne(rawUrl, fallback) {
    const url = await assertPublicUrl(rawUrl)
    let browser
    try {
        browser = await launch()
    } catch (err) {
        console.log('siteCrawler: Chrome unavailable, using plain fetch', err.message)
        return fallback(url.toString())
    }
    try {
        return (await renderPage(browser, url.toString())).markdown
    } finally {
        await browser.close().catch(() => {})
    }
}

// Returns [{ url, title, markdown }] for up to maxPages pages
export async function crawlSite(rawUrl, { maxPages = 25 } = {}) {
    const root = await assertPublicUrl(rawUrl)
    const limit = Math.min(Math.max(1, Number(maxPages) || 25), MAX_PAGES_CAP)
    const start = normalizeLink(root.toString(), root.origin)
    const fromSitemap = await sitemapUrls(root, limit)
    const queue = [start, ...fromSitemap.filter(u => u !== start)]
    const seen = new Set(queue)
    const pages = []

    const browser = await launch()
    try {
        while (queue.length && pages.length < limit) {
            const url = queue.shift()
            try {
                const page = await renderPage(browser, url)
                pages.push({ url, title: page.title, markdown: page.markdown })
                // Sitemap present = it is the page list; otherwise follow links breadth-first
                if (!fromSitemap.length) {
                    page.links.map(href => normalizeLink(href, root.origin)).filter(Boolean).forEach((link) => {
                        if (!seen.has(link) && seen.size < limit * 4) {
                            seen.add(link)
                            queue.push(link)
                        }
                    })
                }
            } catch (err) {
                console.log('siteCrawler: page failed', url, err.message)
            }
        }
    } finally {
        await browser.close().catch(() => {})
    }
    return pages
}
