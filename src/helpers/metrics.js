// App metrics and job spans over OpenTelemetry. With the SDK off (src/otel.js) every call here is a no-op.
// Labels must stay low-cardinality: job/template names and outcomes only, never user/story/workspace ids.
import { metrics, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api'
import logger from './logger.js'

const SCOPE = 'livedemo-backend'
const MONQ_COLLECTION = 'jobs-monq'

const meter = metrics.getMeter(SCOPE)
const tracer = trace.getTracer(SCOPE)

const jobsProcessed = meter.createCounter('livedemo.jobs.processed', {
    description: 'monq jobs finished, by job name and outcome'
})
const jobDuration = meter.createHistogram('livedemo.jobs.duration', {
    unit: 's',
    description: 'monq job run time, from callback start to completion',
    // Jobs range from sub-second events to 30 min video renders
    advice: { explicitBucketBoundaries: [0.1, 0.5, 1, 5, 15, 30, 60, 120, 300, 600, 1200, 1800] }
})
const emailsSent = meter.createCounter('livedemo.emails.sent', {
    description: 'Templated SES emails, by template and outcome'
})

/**
 * Wraps a monq job callback `(params, callback)` with a span and the jobs metrics.
 * The job's own callback / return value / exceptions pass through unchanged.
 */
export function instrumentJob(jobName, run) {

    return (params, callback) => tracer.startActiveSpan(`job ${jobName}`, {
        kind: SpanKind.CONSUMER,
        attributes: { 'messaging.system': 'monq', 'messaging.operation.name': jobName }
    }, (span) => {

        const startedAt = performance.now()
        let finished = false

        const finish = (err) => {

            if (finished) return
            finished = true
            const status = err ? 'error' : 'ok'
            jobsProcessed.add(1, { job_name: jobName, status })
            jobDuration.record((performance.now() - startedAt) / 1000, { job_name: jobName, status })
            if (err) {

                span.recordException(err)
                span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
            }
            span.end()
        }

        try {

            const result = run(params, (err, ...rest) => {

                finish(err)
                return callback(err, ...rest)
            })
            // Async handlers that reject without calling back still count as failed
            if (result && typeof result.catch === 'function') {

                result.catch((err) => finish(err instanceof Error ? err : new Error(String(err))))
            }
            return result
        } catch (err) {

            finish(err)
            throw err
        }
    })
}

/**
 * Reports queued monq jobs per queue at each metrics export.
 * `db` is the native driver Db of an open connection (mongoose `conn.db`).
 */
export function observeQueuedJobs(db) {

    const queued = meter.createObservableGauge('livedemo.jobs.queued', {
        description: 'monq jobs waiting to be picked up, by queue'
    })

    queued.addCallback(async (result) => {

        try {

            const rows = await db.collection(MONQ_COLLECTION).aggregate([
                { $match: { status: 'queued' } },
                { $group: { _id: '$queue', count: { $sum: 1 } } }
            ]).toArray()
            rows.forEach((row) => result.observe(row.count, { queue: row._id }))
        } catch (err) {

            logger.error('queued jobs metric failed', { eventName: 'METRICS_JOBS_QUEUED_FAILED', err: err.message })
        }
    })
}

export function recordEmailSent(template, ok) {

    emailsSent.add(1, { template, status: ok ? 'ok' : 'error' })
}
