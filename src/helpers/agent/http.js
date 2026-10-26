import ResponseCodes from '../../constants/ResponseCodes.js'

import logger from '../logger.js'

// One tiny response helper for every agent handler instead of duplicating the
// 40-line CORS/catch boilerplate 25 times. Same headers as the story handlers.
export const CORS_HEADERS = {
  'Access-Control-Max-Age': 600,
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
  'Access-Control-Allow-Credentials': true,
}

export function sendJson(res, payload, statusCode = ResponseCodes['200_OK']) {
  res.set(CORS_HEADERS)
  res.status(statusCode)
  res.send(payload === undefined ? '' : JSON.stringify(payload))
}

export function sendError(res, error) {
  logger.error(error, { eventName: 'HTTP_FAILED' })

  const resultResponse = error.resultResponse || {
    statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
    headers: CORS_HEADERS,
    body: '',
  }

  res.set(resultResponse.headers)
  res.status(resultResponse.statusCode)
  res.send(resultResponse.body)
}

export function httpError(statusCode, message) {
  const error = new Error(message)
  error.resultResponse = {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ message }),
  }
  throw error
}
