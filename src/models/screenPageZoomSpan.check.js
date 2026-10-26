// Runnable check: step zoom spans must be reachable on the BASE Screen schema.
//
// The step zoom span handlers query via Models.Screen so they work for every
// discriminator. That only holds if `steps.zoomSpan` lives on the base Screen
// schema -- if it were declared on a discriminator only, strict mode would
// silently drop the write and populate() would strip the field on read.
//
// Run: node src/models/screenPageZoomSpan.check.js

import assert from 'assert'
import mongoose from 'mongoose'
import ScreenSchema from './Screen.js'
import Screen_PageSchema from './Screen_Page.js'
import ScreenTypes from '../constants/ScreenTypes.js'

import logger from '../helpers/logger.js'

const conn = mongoose.createConnection()
const ScreenModel = conn.model('Screen', ScreenSchema)
const PageModel = ScreenModel.discriminator(ScreenTypes.SCREEN_PAGE, Screen_PageSchema)

const ZOOM_SPAN_FIELDS = ['delay', 'duration', 'width', 'height', 'editorWidth', 'editorHeight', 'offsetX', 'offsetY']

for (const model of [ScreenModel, PageModel]) {
  for (const field of ZOOM_SPAN_FIELDS) {
    const path = `steps.zoomSpan.${field}`
    assert.ok(
      model.schema.path(path),
      `${model.modelName} is missing schema path "${path}" -- step zoom span writes would be silently dropped`
    )
  }
}

// A page screen must accept a step zoom span through the base model without
// stripping it, which is exactly what postStepZoomSpans/patchStepZoomSpan do.
const pageDoc = new PageModel({
  type: ScreenTypes.SCREEN_PAGE,
  steps: [{ zoomSpan: { delay: 0.5, duration: 1.5, width: 300, height: 300, editorWidth: 1366, editorHeight: 664, offsetX: 533, offsetY: 182 } }],
})

const savedSpan = pageDoc.steps[0].zoomSpan
assert.ok(savedSpan, 'page step zoomSpan was stripped by strict mode')
assert.strictEqual(savedSpan.delay, 0.5)
assert.strictEqual(savedSpan.duration, 1.5)
assert.strictEqual(savedSpan.offsetX, 533)
assert.strictEqual(pageDoc.type, ScreenTypes.SCREEN_PAGE, 'discriminator key changed')

logger.info('OK: step zoom spans are reachable on Screen and Screen_Page', { eventName: 'OK_STEP_ZOOM_SPANS_ARE_REACHABLE_ON_SCREEN_AND_SCREEN_PAGE' })
process.exit(0)
