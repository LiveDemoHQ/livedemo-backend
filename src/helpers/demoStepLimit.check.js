/**
 * ponytail: assert-based self-check for demo step counting.
 * Run: node src/helpers/demoStepLimit.check.js
 */
import demoStepLimit from './demoStepLimit.js'

import logger from './logger.js'

const { countRenderSteps } = demoStepLimit

function assert(cond, msg) {
    if (!cond) {
        throw new Error(msg)
    }
}

assert(countRenderSteps([]) === 0, 'empty story = 0')
assert(countRenderSteps([{ steps: [] }]) === 1, 'empty screen = 1 placeholder')
assert(countRenderSteps([{ steps: [{}, {}] }]) === 2, '2 steps on one screen')
assert(countRenderSteps([
    { steps: [{}] },
    { steps: [] },
    { steps: [{}, {}] }
]) === 4, '1 + 1 placeholder + 2 = 4')

logger.info('demoStepLimit.check: ok', { eventName: 'DEMOSTEPLIMIT_CHECK_OK' })
