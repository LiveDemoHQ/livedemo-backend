import helpers from '../helpers/livedemoHelpers.js'
import { markUserActivated } from '../helpers/emailHelpers.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { findTemplate } from '../helpers/agent/agentTemplates.js'
import { normalizeGoal } from '../helpers/agent/goalFlows.js'
import { normalizeQualification } from '../helpers/agent/qualification.js'
import postAgentValidator from '../helpers/validators/agents/postAgentValidator.js'

// POST /workspaces/:workspaceId/agents  { name, templateId? }
// Workspace comes from the URL, never a picker (same shape as postEmptyStory).
const handler = async function (req, res) {
  const { Models } = req.mongo
  const workspaceId = req.params.workspaceId

  try {
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, workspaceId)

    const body = helpers.validateBody(req.body || {}, postAgentValidator).value
    const template = body.templateId ? findTemplate(body.templateId) : null
    if (body.templateId && !template) httpError(ResponseCodes['400_BAD_REQUEST'], 'Unknown templateId')
    const name = body.name || (template ? template.name : 'Untitled agent')

    const config = template ? template.config : {}
    const agent = await new Models.AiDemoAgent({
      name,
      workspaceId,
      userId: authUser.id,
      ...(config.welcomeMessage ? { welcomeMessage: config.welcomeMessage } : {}),
      ...(config.starterQuestions ? { starterQuestions: config.starterQuestions } : {}),
      ...(config.goal ? { goal: normalizeGoal(config.goal) } : {}),
      ...(config.qualification ? { qualification: normalizeQualification(config.qualification) } : {}),
    }).save()

    await markUserActivated(Models, authUser._id)

    sendJson(res, { _id: agent._id })
  } catch (error) {
    sendError(res, error)
  }
}

export default handler
