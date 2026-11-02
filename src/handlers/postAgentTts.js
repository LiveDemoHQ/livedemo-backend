import loadPublicAgent from '../helpers/agent/loadPublicAgent.js'
import speakAgentText from '../helpers/agent/speakAgentText.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import helpers from '../helpers/livedemoHelpers.js'
import postAgentTtsValidator from '../helpers/validators/agents/postAgentTtsValidator.js'

// POST /agents/:agentId/tts — speak welcome or ad-hoc text (e.g. before first chat turn).
// Editor workspace twin is registered but always rejects — no speech in editor preview.
const handler = async function (req, res) {
  const { Models } = req.mongo

  try {
    if (req.params.workspaceId) {
      httpError(ResponseCodes['400_BAD_REQUEST'], 'Voice output is disabled in editor preview')
    }

    const agent = await loadPublicAgent(req, Models, req.params.agentId)

    const text = String(helpers.validateBody(req.body || {}, postAgentTtsValidator).value.text || '').trim()
    if (!text) {
      httpError(ResponseCodes['400_BAD_REQUEST'], 'text is required')
    }
    if (!agent.voiceEnabled) {
      httpError(ResponseCodes['400_BAD_REQUEST'], 'Voice is not enabled for this agent')
    }

    const audio = await speakAgentText(agent, text)
    if (!audio) {
      httpError(ResponseCodes['503_SERVICE_UNAVAILABLE'], 'Could not generate speech')
    }

    sendJson(res, audio)
  } catch (error) {
    sendError(res, error)
  }
}

export default handler
