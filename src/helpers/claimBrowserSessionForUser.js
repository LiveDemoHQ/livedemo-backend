import { cloneUrlDemoStoriesForUser } from './cloneUrlDemoStoriesForUser.js'
import { claimOwnRequestsForUser, cleanSessionId } from './own/own.js'

// Everything an anonymous browser session left behind, handed to the user who just signed up / logged in:
// browsed UrlDemos (cloned inline) and "Make it yours" clicks (enqueued). Never throws: auth must not fail on it
export default async function claimBrowserSessionForUser(browserSessionId, userDoc, Models) {
    const sessionId = cleanSessionId(browserSessionId)
    if (!sessionId || !userDoc) return

    await cloneUrlDemoStoriesForUser(sessionId, userDoc, Models)
        .catch(err => console.error('[claimBrowserSessionForUser] cloneUrlDemoStoriesForUser error', err))
    await claimOwnRequestsForUser(sessionId, userDoc, Models)
        .catch(err => console.error('[claimBrowserSessionForUser] claimOwnRequestsForUser error', err))
}
