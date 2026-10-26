import monq from 'monq'
import ENV from '../../envServer.js'

import logger from '../logger.js'

// Same enqueue pattern as postStorySession.js. sourceId optional — omitted
// means "reindex every source of this agent".
export default function enqueueIndexAgentKnowledge(agentId, sourceId = null) {
  const client = monq(ENV.DB_URI || 'mongodb://localhost:27017/livedemo_app')
  const queue = client.queue('agent-knowledge', { collection: 'jobs-monq' })

  return new Promise((resolve, reject) => {
    queue.enqueue('indexAgentKnowledge', {
      agentId: agentId.toString(),
      sourceId: sourceId ? sourceId.toString() : null,
    }, function (err, job) {
      if (err) {
        return reject(err)
      }
      logger.info('Enqueued indexAgentKnowledge:', { eventName: 'ENQUEUED_INDEXAGENTKNOWLEDGE', data: { detail: job.data } })
      resolve()
    })
  })
}
