// OpenTelemetry bootstrap: `node --import ./src/otel.js ...` (see start.sh), so it runs before the app imports anything.
// Exporters, endpoint, sampler and service name come from OTEL_* env (k8s ConfigMap otel-common-env).
// Opt-in: only OTEL_SDK_DISABLED=false enables it, so runs without the k8s env (IDE, scripts, local.env) stay a no-op.
import { register } from 'node:module'
import { createAddHookMessageChannel } from 'import-in-the-middle'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources'

// Probes and the GCE health check: high volume, no value as spans
const PROBE_PATHS = new Set(['/', '/healthz', '/readyz'])
const SHUTDOWN_TIMEOUT_MS = 5000

if (process.env.OTEL_SDK_DISABLED === 'false') {

    // The app is native ESM; this hook lets instrumentations patch modules loaded with `import`.
    // Only modules an instrumentation asked for are wrapped: wrapping everything breaks @mux/mux-node's shim check.
    const { registerOptions, waitForAllMessagesAcknowledged } = createAddHookMessageChannel()
    register('import-in-the-middle/hook.mjs', import.meta.url, registerOptions)

    const sdk = new NodeSDK({
        // story-api and monq-worker set OTEL_SERVICE_NAME; this is only the fallback
        serviceName: process.env.OTEL_SERVICE_NAME || 'livedemo-backend',
        resource: defaultResource().merge(resourceFromAttributes({
            // Baked into the image from the commit SHA (Dockerfile ARG SERVICE_VERSION)
            'service.version': process.env.SERVICE_VERSION || 'unknown'
        })),
        instrumentations: [
            getNodeAutoInstrumentations({
                '@opentelemetry/instrumentation-fs': { enabled: false },
                '@opentelemetry/instrumentation-dns': { enabled: false },
                '@opentelemetry/instrumentation-net': { enabled: false },
                '@opentelemetry/instrumentation-http': {
                    ignoreIncomingRequestHook: (req) => PROBE_PATHS.has((req.url || '').split('?')[0])
                }
            })
        ]
    })

    sdk.start()
    // The loader runs on its own thread: wait until it knows every hooked module before the app starts importing
    await waitForAllMessagesAcknowledged()

    // Flush buffered logs/metrics before the pod goes away; never hold shutdown longer than the timeout
    process.once('SIGTERM', () => {

        const timer = setTimeout(() => process.exit(0), SHUTDOWN_TIMEOUT_MS)
        sdk.shutdown().finally(() => {

            clearTimeout(timer)
            process.exit(0)
        })
    })
}
