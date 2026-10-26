import { cloneUrlDemoStoriesForUser } from './cloneUrlDemoStoriesForUser.js'
import { claimOwnRequestsForUser, cleanSessionId } from './own/own.js'
import { claimMigrateDemosForUser } from './migrateDemos.js'

import logger from './logger.js'

// Everything an anonymous browser session left behind, handed to the user who just signed up / logged in:
// browsed UrlDemos (cloned inline), "Make it yours" clicks and requested demo clones (enqueued).
// Never throws: auth must not fail on it
export default async function claimBrowserSessionForUser(browserSessionId, userDoc, Models) {
    const sessionId = cleanSessionId(browserSessionId)
    if (!sessionId || !userDoc) return

    await cloneUrlDemoStoriesForUser(sessionId, userDoc, Models)
        .catch(err => logger.error('[claimBrowserSessionForUser] cloneUrlDemoStoriesForUser error', { eventName: 'CLONEURLDEMOSTORIESFORUSER_ERROR', err: err }))
    await claimOwnRequestsForUser(sessionId, userDoc, Models)
        .catch(err => logger.error('[claimBrowserSessionForUser] claimOwnRequestsForUser error', { eventName: 'CLAIMOWNREQUESTSFORUSER_ERROR', err: err }))
    // after the "Make it yours" clicks, so a click on the same demo dedups to one copy
    await claimMigrateDemosForUser(sessionId, userDoc, Models)
        .catch(err => logger.error('[claimBrowserSessionForUser] claimMigrateDemosForUser error', { eventName: 'CLAIMMIGRATEDEMOSFORUSER_ERROR', err: err }))
}
