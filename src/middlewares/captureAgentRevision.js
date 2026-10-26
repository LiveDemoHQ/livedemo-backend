import { captureAgentPreImage, recordRevision } from '../helpers/agentRevisions.js'

import logger from '../helpers/logger.js'

// Clone of captureStoryRevision.js for AiDemoAgent routes. Reads the agent +
// its knowledge sources into memory before the handler runs, records the
// pre-image on the undo stack only when the handler responded 2xx.
// History must never block the edit itself.
const captureAgentRevision = (actionLabel) =>
  async (req, res, next) => {
    try {
      const { Models } = req.mongo
      const { workspaceId, agentId } = req.params

      const payload = await captureAgentPreImage(Models, { agentId, workspaceId })

      if (payload) {
        res.on('finish', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            recordRevision(Models, { ...payload, actionLabel })
              .catch(err => logger.error('agentRevision record failed', { eventName: 'AGENTREVISION_RECORD_FAILED', err: err }))
          }
        })
      }
    } catch (err) {
      logger.error('agentRevision capture failed', { eventName: 'AGENTREVISION_CAPTURE_FAILED', err: err })
    }

    next()
  }

export default captureAgentRevision
