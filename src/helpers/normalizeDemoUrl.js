// One MigrateDemo per normalized link. Must match livedemo-ai-api/clone/normalizeDemoUrl.js
export default function normalizeDemoUrl(url) {

    const u = new URL(url)
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/$/, '')}${u.search}`
}
