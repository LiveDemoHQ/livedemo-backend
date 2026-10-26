import helpers from '../helpers/livedemoHelpers.js'
import postCustomSecurityValidator from '../helpers/validators/stories/custom/postCustomSecurityValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'

import logger from '../helpers/logger.js'

const VALID_CSP_DIRECTIVES = [
  'default-src', 'script-src', 'style-src', 'img-src', 'connect-src',
  'font-src', 'frame-src', 'media-src', 'object-src', 'manifest-src',
  'worker-src', 'child-src', 'form-action', 'frame-ancestors',
  'base-uri', 'navigate-to', 'report-uri', 'report-to',
]

const VALID_KEYWORD_SOURCES = [
  "'self'", "'unsafe-inline'", "'unsafe-eval'", "'none'",
  "'strict-dynamic'", "'unsafe-hashes'", 'data:', 'blob:', '*',
]

function isValidOrigin(value) {
  // Allow *, data:, blob:, keywords
  if (VALID_KEYWORD_SOURCES.includes(value)) return true
  // Allow wildcard subdomain patterns like *.example.com
  if (/^\*\.[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/.test(value)) return true
  // Allow http/https URLs (with optional wildcard subdomain and path)
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function parseAndValidateCSP(rawCsp) {
  if (!rawCsp || !rawCsp.trim()) return { valid: true, parsed: '' }

  // Strip newlines — cannot be in HTTP headers
  const sanitized = rawCsp.replace(/[\r\n]/g, ' ').trim()

  const directives = sanitized.split(';').map(d => d.trim()).filter(Boolean)
  const validDirectives = []
  const errors = []

  for (const directive of directives) {
    const parts = directive.split(/\s+/)
    const directiveName = parts[0].toLowerCase()
    const sources = parts.slice(1)

    if (!VALID_CSP_DIRECTIVES.includes(directiveName)) {
      errors.push(`Unknown directive: "${directiveName}"`)
      continue
    }

    const validSources = []
    for (const source of sources) {
      if (isValidOrigin(source)) {
        validSources.push(source)
      } else {
        errors.push(`Invalid source "${source}" in directive "${directiveName}"`)
      }
    }

    validDirectives.push([directiveName, ...validSources].join(' '))
  }

  return {
    valid: errors.length === 0,
    errors,
    parsed: validDirectives.join('; '),
  }
}

const handler = function (req, res) {
  let { Models } = req.mongo

  let workspaceId = req.params.workspaceId
  let storyId = req.params.storyId
  let requestBody = null
  let authUserDoc = null

  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser

      let validatedBody = helpers.validateBody(req.body, postCustomSecurityValidator)
      requestBody = validatedBody.value

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(async () => {
      const raw = requestBody.additionalContentSecurityPolicy

      const { valid, errors, parsed } = parseAndValidateCSP(raw)

      if (!valid) {
        const resultResponse = {
          statusCode: ResponseCodes['400_BAD_REQUEST'] || 400,
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
            'Access-Control-Allow-Credentials': true,
          },
          body: JSON.stringify({ errors })
        }
        res.set(resultResponse.headers)
        res.status(resultResponse.statusCode)
        res.send(resultResponse.body)
        return null
      }

      return Models.Story.findOneAndUpdate({
        _id: storyId
      }, {
        $set: {
          'custom.security.additionalContentSecurityPolicy': parsed,
        }
      }, { new: true })
    })
    .then((newStoryDoc) => {
      if (!newStoryDoc) return

      const resultResponse = {
        statusCode: ResponseCodes['200_OK'],
        headers: {
          'Access-Control-Max-Age': 600,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
          'Access-Control-Allow-Credentials': true,
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(JSON.stringify(newStoryDoc.custom.security))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_CUSTOM_SECURITY_FAILED' })

      let resultResponse
      if (error.resultResponse) {
        resultResponse = error.resultResponse
      } else {
        resultResponse = {
          statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
            'Access-Control-Allow-Credentials': true,
          },
          body: ''
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body)
    })
}

export default handler
