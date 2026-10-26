import { captureScreenPreImage, captureStoryPreImage, recordRevision } from '../helpers/storyRevisions.js'

import logger from '../helpers/logger.js'

// Captures a pre-image of what the wrapped route can touch (one Screen doc, or the
// Story doc + screen index list) and appends it to the story's undo stack — but only
// if the handler finished 2xx, so failed auth/validation records nothing.
//
// Runs before the handler's own authReq, but it only *reads* into memory; nothing
// persists unless the handler itself succeeded, which implies auth + workspace
// access checks passed.
//
// ponytail: pre-image read and handler write aren't atomic — concurrent edits to the
// same screen are last-writer-wins, exactly as the editor already is today. Upgrade
// path: optimistic versioning on Screen.
const captureStoryRevision = (scope, actionLabel, { fullScreens = false } = {}) =>
  async (req, res, next) => {
    try {
      const { Models } = req.mongo
      const { workspaceId, storyId, screenId } = req.params

      const payload = scope === 'screen'
        ? await captureScreenPreImage(Models, { storyId, workspaceId, screenId })
        : await captureStoryPreImage(Models, { storyId, workspaceId, fullScreens })

      if (payload) {
        res.on('finish', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            recordRevision(Models, { ...payload, actionLabel })
              .catch(err => logger.error('storyRevision record failed', { eventName: 'STORYREVISION_RECORD_FAILED', err: err }))
          }
        })
      }
    } catch (err) {
      // History must never block editing
      logger.error('storyRevision capture failed', { eventName: 'STORYREVISION_CAPTURE_FAILED', err: err })
    }

    next()
  }

export default captureStoryRevision
