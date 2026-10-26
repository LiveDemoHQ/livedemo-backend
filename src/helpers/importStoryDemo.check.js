// node src/helpers/importStoryDemo.check.js
import assert from 'assert'
import { importPayloadIssue } from './importStoryDemo.js'
import validate from './validators/stories/postStoryImportValidator.js'

import logger from './logger.js'

const full = { type: 2 }
const base = { screenDoc: { _id: 'a', recordingRole: 'base' }, events: [{ type: 4 }, full] }
const delta = { screenDoc: { _id: 'b', recordingRole: 'delta', baseScreenId: 'a' }, events: [{ type: 3 }] }
const story = (...ids) => ({ screens: ids.map((_id) => ({ _id })) })

assert.equal(importPayloadIssue({ story: story('a', 'b'), screens: [base, delta] }), null)
assert.match(importPayloadIssue({ story: story(), screens: [] }), /non-empty/)
assert.match(importPayloadIssue({ story: story('a', 'x'), screens: [base] }), /x missing/)
assert.match(importPayloadIssue({ story: story('a'), screens: [{ ...base, events: [full, full] }] }), /exactly one FullSnapshot/)
assert.match(importPayloadIssue({ story: story('b'), screens: [delta] }), /baseScreenId/)
assert.match(importPayloadIssue({ story: story('a'), screens: [{ ...base, events: [] }] }), /events must be/)

const id = (n) => String(n).padStart(24, '0')
const vBase = { screenDoc: { _id: id(1), recordingRole: 'base', name: 'x' }, events: [full], imageData: '' }
const vDelta = { screenDoc: { _id: id(2), recordingRole: 'delta', baseScreenId: id(1) }, events: [] }
const vStory = { name: 's', screens: [{ _id: id(1), index: 0 }, { _id: id(2) }] }
assert.equal(validate({ story: vStory, screens: [vBase, vDelta] }).error, undefined)
assert.equal(validate({ story: vStory, screens: [vBase, vDelta] }).value.screens[0].screenDoc.name, 'x')
assert(validate({ story: vStory, screens: [vBase], extra: 1 }).error)
assert(validate({ story: { screens: [] }, screens: [vBase] }).error)
assert(validate({ story: vStory, screens: [{ ...vBase, screenDoc: { _id: 'nope' } }] }).error)
assert(validate({ story: vStory, screens: [{ ...vDelta, screenDoc: { _id: id(2), recordingRole: 'delta' } }] }).error)
assert(validate({ story: vStory, screens: [{ ...vBase, screenDoc: { ...vBase.screenDoc, recordingRole: 'other' } }] }).error)
assert(validate({ story: vStory, screens: [{ screenDoc: vBase.screenDoc }] }).error)
logger.info('OK', { eventName: 'OK' })
