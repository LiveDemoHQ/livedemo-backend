// Self-check for feedback body shape. Run: node src/helpers/validators/feedbackBody.check.js
import assert from 'assert'
import validateFeedback, { validateUninstallFeedback } from './feedbackBody.js'

const ok = validateFeedback({ message: '  the popup froze  ' })
assert.strictEqual(ok.error, undefined)
assert.strictEqual(ok.value.message, 'the popup froze')

const empty = validateFeedback({ message: '   ' })
assert.ok(empty.error)

const long = validateFeedback({ message: 'x'.repeat(4001) })
assert.ok(long.error)

const badWorkspace = validateFeedback({
  message: 'hi',
  workspaceId: 'not-an-id',
})
assert.ok(badWorkspace.error)

const goodWorkspace = validateFeedback({
  message: 'hi',
  workspaceId: '507f1f77bcf86cd799439011',
  extensionVersion: '1.0.46',
  source: 'chrome-extension',
})
assert.strictEqual(goodWorkspace.error, undefined)
assert.strictEqual(goodWorkspace.value.workspaceId, '507f1f77bcf86cd799439011')

const uninstall = validateUninstallFeedback({
  reason: 'broken',
  message: '  stop did nothing  ',
  extensionVersion: '1.0.46',
})
assert.strictEqual(uninstall.error, undefined)
assert.strictEqual(uninstall.value.message, 'stop did nothing')

const missingReason = validateUninstallFeedback({ message: 'hi' })
assert.ok(missingReason.error)

const badReason = validateUninstallFeedback({ reason: 'spam' })
assert.ok(badReason.error)

console.log('feedbackBody ok')
