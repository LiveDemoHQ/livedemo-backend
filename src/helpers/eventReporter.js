import logger from './logger.js'
// Simplified EventReporter for story-api
// This is a no-op implementation that can be extended later if needed

function storeInfoEvent(name, data) {
  // For now, just log the event
  // In the future, this could make HTTP requests to an event reporting service
  logger.info(`[Event] ${name}:`, { eventName: 'EVENT_REPORTER', data: { detail: JSON.stringify(data) } })
  return Promise.resolve()
}

function storeErrorEvent(name, data) {
  logger.error(`[Error Event] ${name}:`, { eventName: 'EVENT_REPORTER_FAILED', data: { detail: JSON.stringify(data) } })
  return Promise.resolve()
}

function storeEvent(name, type, data) {
  logger.info(`[Event] ${name} (${type}):`, { eventName: 'EVENT_REPORTER', data: { detail: JSON.stringify(data) } })
  return Promise.resolve()
}

export default {
  storeEvent,
  storeInfoEvent,
  storeErrorEvent
}
