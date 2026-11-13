// node src/helpers/renderMillis.check.js
import assert from 'assert'
import { secondsBetween } from './renderMillis.js'

assert.equal(secondsBetween(0, 0), 0)
assert.equal(secondsBetween(1500, 0), 1.5)
assert.equal(secondsBetween(0, 1500), 1.5)
// 100.05s. toPrecision(4) rounds this to 100.1.
assert.equal(secondsBetween(100050, 0), 100.05)
// 1000.4s. toPrecision(4) rounds this to 1000.
assert.equal(secondsBetween(1000400, 0), 1000.4)

console.log('renderMillis.check ok')
