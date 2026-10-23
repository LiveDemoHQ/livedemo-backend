import ResponseCodes from '../constants/ResponseCodes.js'
import DemoLimits from '../constants/DemoLimits.js'

const CORS_HEADERS = {
    'Access-Control-Max-Age': 600,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
    'Access-Control-Allow-Credentials': true
}

/**
 * Matches web-app deriveRenderSteps: each screen contributes its steps.length,
 * or 1 placeholder if the screen has no steps yet.
 */
function countRenderSteps(screens) {
    if (!screens || !screens.length) {
        return 0
    }

    return screens.reduce((sum, screen) => {
        const steps = screen && screen.steps
        if (steps && steps.length) {
            return sum + steps.length
        }
        return sum + 1
    }, 0)
}

function throwStepLimit(current, limit = DemoLimits.MAX_DEMO_STEPS) {
    const error = new Error('Demo step limit reached')
    error.resultResponse = {
        statusCode: ResponseCodes['400_BAD_REQUEST'],
        headers: CORS_HEADERS,
        body: JSON.stringify({
            error: 'Demo step limit reached',
            code: 'DEMO_STEP_LIMIT',
            limit,
            current
        })
    }
    throw error
}

function assertClickCount(count, limit = DemoLimits.MAX_DEMO_STEPS) {
    if (count > limit) {
        throwStepLimit(count, limit)
    }
}

function assertCanAddStep(screens, screenId) {
    const current = countRenderSteps(screens)
    const screen = (screens || []).find((s) => String(s._id) === String(screenId))
    const steps = screen && screen.steps
    // Empty screen already counts as 1 render step — first real step does not increase.
    const extra = (steps && steps.length) ? 1 : 0

    if (current + extra > DemoLimits.MAX_DEMO_STEPS) {
        throwStepLimit(current)
    }
}

export default {
    countRenderSteps,
    assertClickCount,
    assertCanAddStep,
    throwStepLimit
}
