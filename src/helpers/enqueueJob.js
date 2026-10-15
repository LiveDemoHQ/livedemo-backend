import monq from 'monq'
import ENV from '../envServer.js'

let client = null

// Same enqueue pattern as enqueueIndexJob.js, one shared client.
// options: monq enqueue options, e.g. { attempts: { count: 4, delay: 30000, strategy: 'exponential' } }
export default function enqueueJob(queueName, jobName, params, options = {}) {
    if (!client) client = monq(ENV.DB_URI || 'mongodb://localhost:27017/livedemo_app')
    const queue = client.queue(queueName, { collection: 'jobs-monq' })

    return new Promise((resolve, reject) => {
        queue.enqueue(jobName, params, options, (err, job) => {
            if (err) return reject(err)
            resolve(job)
        })
    })
}
