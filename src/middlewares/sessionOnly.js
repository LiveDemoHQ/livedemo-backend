import ResponseCodes from '../constants/ResponseCodes.js'
import { CORS_HEADERS } from '../helpers/agent/http.js'
import { API_TOKEN_RE } from '../helpers/authHelpers.js'

// API keys / OAuth tokens (MCP) act on content only. Account, credential, key, SSO and domain
// management need a real signed-in session, so a leaked key can't take over the account.
export default function sessionOnly(req, res, next) {
    const token = String(req.get('Authorization') || '').split(' ')[1] || (req.body && req.body.token) || ''
    if (!API_TOKEN_RE.test(String(token))) return next()
    res.set(CORS_HEADERS)
    res.status(ResponseCodes['403_FORBIDDEN'])
    res.send(JSON.stringify({ message: 'This action needs a signed-in session, not an API key' }))
}
