import helpers from '../helpers/livedemoHelpers.js'
import loadAgentInWorkspace from '../helpers/agent/loadAgentInWorkspace.js'
import enqueueIndexAgentKnowledge from '../helpers/agent/enqueueIndexJob.js'
import { getAllowedDemos } from '../helpers/agent/validateActions.js'
import { findStockAvatar, findStockVoice, pickAvatarModel } from '../helpers/agent/anam.js'
import { findAvatar as findLemonSliceAvatar } from '../helpers/agent/lemonslice.js'
import avatarVideoUrl from '../helpers/agent/avatarVideo.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import { normalizeSummarySettings } from '../helpers/agent/summaryEmail.js'
import { embedPatchUpdates } from '../helpers/agent/embed.js'
import { normalizeQualification } from '../helpers/agent/qualification.js'

// PATCH /workspaces/:workspaceId/agents/:agentId
// Persona fields + allowedDemoIds. Wrapped by captureAgentRevision in server.js.
const PATCHABLE_FIELDS = [
  'name', 'welcomeMessage', 'starterQuestions', 'systemPrompt', 'avatarUrl',
  'voiceEnabled', 'voiceId', 'avatarsEnabled', 'avatarVoice', 'visitorCapture', 'cta', 'theme',
]

const handler = async function (req, res) {
  const { Models } = req.mongo
  const { workspaceId, agentId } = req.params
  const body = req.body || {}

  try {
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, workspaceId)

    const agent = await loadAgentInWorkspace(Models, workspaceId, agentId)

    // Setting default while the demos-tab checkbox patch is still in flight used to
    // 400 when allowedDemoIds was non-empty but didn't yet include the new default.
    if (body.defaultDemoId && body.allowedDemoIds === undefined) {
      const current = agent.allowedDemoIds || []
      if (current.length && !current.some(id => String(id) === String(body.defaultDemoId))) {
        body.allowedDemoIds = [...current, body.defaultDemoId]
      }
    }

    const updates = {}
    PATCHABLE_FIELDS.forEach((field) => {
      if (body[field] !== undefined) {
        updates[field] = body[field]
      }
    })

    // Face pick: stock avatars only. Model + card thumbnail come from Anam, not the client.
    if (body.anamAvatarId !== undefined && String(body.anamAvatarId || '') !== String(agent.anamAvatarId || '')) {
      const avatarId = String(body.anamAvatarId || '')
      if (!avatarId) {
        updates.anamAvatarId = ''
        updates.anamAvatarModel = ''
        updates.avatarUrl = ''
      } else {
        const avatar = await findStockAvatar(avatarId)
        if (!avatar) {
          httpError(ResponseCodes['400_BAD_REQUEST'], 'anamAvatarId must be a stock Anam avatar')
        }
        updates.anamAvatarId = avatar.id
        updates.anamAvatarModel = pickAvatarModel(avatar)
        updates.avatarUrl = avatar.imageUrl
      }
    }

    if (body.avatarProvider !== undefined && !['anam', 'lemonslice'].includes(body.avatarProvider)) {
      httpError(ResponseCodes['400_BAD_REQUEST'], 'avatarProvider must be anam or lemonslice')
    }
    if (body.lemonsliceAvatarId !== undefined && body.lemonsliceAvatarId && !(await findLemonSliceAvatar(Models, workspaceId, body.lemonsliceAvatarId))) {
      httpError(ResponseCodes['400_BAD_REQUEST'], 'lemonsliceAvatarId must be a LemonSlice avatar of this workspace')
    }
    if (body.avatarProvider !== undefined) updates.avatarProvider = body.avatarProvider
    if (body.lemonsliceAvatarId !== undefined) updates.lemonsliceAvatarId = String(body.lemonsliceAvatarId || '')

    // Card thumbnail follows the active provider's face
    const provider = updates.avatarProvider ?? agent.avatarProvider ?? 'anam'
    const providerChanged = provider !== (agent.avatarProvider || 'anam')
    if (provider === 'lemonslice' && (providerChanged || updates.lemonsliceAvatarId !== undefined || updates.anamAvatarId !== undefined)) {
      updates.avatarUrl = (await findLemonSliceAvatar(Models, workspaceId, updates.lemonsliceAvatarId ?? agent.lemonsliceAvatarId))?.imageUrl || ''
    } else if (provider === 'anam' && providerChanged && updates.anamAvatarId === undefined) {
      updates.avatarUrl = agent.anamAvatarId ? (await findStockAvatar(agent.anamAvatarId))?.imageUrl || '' : ''
    }
    if (providerChanged || updates.anamAvatarId !== undefined || updates.lemonsliceAvatarId !== undefined) {
      const faceId = provider === 'lemonslice'
        ? updates.lemonsliceAvatarId ?? agent.lemonsliceAvatarId
        : updates.anamAvatarId ?? agent.anamAvatarId
      updates.avatarVideoUrl = await avatarVideoUrl(Models, workspaceId, provider, faceId)
    }

    if (updates.avatarVoice !== undefined && !['elevenlabs', 'anam'].includes(updates.avatarVoice)) {
      httpError(ResponseCodes['400_BAD_REQUEST'], 'avatarVoice must be elevenlabs or anam')
    }
    if (updates.theme !== undefined && !['light', 'dark', 'dark-blur', 'light-blur'].includes(updates.theme)) {
      httpError(ResponseCodes['400_BAD_REQUEST'], 'theme must be light, dark, dark-blur or light-blur')
    }

    if (body.anamVoiceId !== undefined && String(body.anamVoiceId || '') !== String(agent.anamVoiceId || '')) {
      const voiceId = String(body.anamVoiceId || '')
      if (voiceId && !(await findStockVoice(voiceId))) {
        httpError(ResponseCodes['400_BAD_REQUEST'], 'anamVoiceId must be a stock Anam voice')
      }
      updates.anamVoiceId = voiceId
    }

    // Demos-tab import: every id must be a live Story of THIS workspace
    if (body.allowedDemoIds !== undefined) {
      const ids = body.allowedDemoIds || []
      const stories = await Models.Story.find({
        _id: { $in: ids },
        workspaceId,
        deletedAt: null,
      }).select('_id').lean()

      if (stories.length !== ids.length) {
        httpError(ResponseCodes['400_BAD_REQUEST'], 'allowedDemoIds must be stories of this workspace')
      }

      updates.allowedDemoIds = ids

      // Upsert one demo-derived knowledge source per selected story, drop deselected
      const keptIds = ids.map(String)
      const existing = await Models.AgentKnowledgeSource.find({ agentId, type: 'demo' }).lean()

      const toRemove = existing.filter(s => !keptIds.includes(String(s.demoId)))
      for (const source of toRemove) {
        await Models.AgentKnowledgeChunk.deleteMany({ sourceId: source._id, agentId })
        await Models.AgentKnowledgeSource.deleteOne({ _id: source._id })
        await Models.AiDemoAgent.updateOne({ _id: agentId }, { $pull: { knowledgeSourceIds: source._id } })
      }

      const existingDemoIds = existing.map(s => String(s.demoId))
      const storyDocs = await Models.Story.find({ _id: { $in: ids } }).select('_id name').lean()
      for (const story of storyDocs) {
        if (existingDemoIds.includes(String(story._id))) continue
        const source = await new Models.AgentKnowledgeSource({
          agentId,
          workspaceId,
          type: 'demo',
          title: `${story.name || 'Untitled demo'} — auto from demo`,
          demoId: story._id,
          status: 'pending',
        }).save()
        await Models.AiDemoAgent.updateOne({ _id: agentId }, { $addToSet: { knowledgeSourceIds: source._id } })
      }

      enqueueIndexAgentKnowledge(agentId).catch(err => console.log('enqueue reindex failed', err))

      if (agent.defaultDemoId) {
        const stillAllowed = !ids.length || ids.some(id => String(id) === String(agent.defaultDemoId))
        if (!stillAllowed) updates.defaultDemoId = null
      }
    }

    if (body.defaultDemoId !== undefined) {
      const nextDefault = body.defaultDemoId || null
      if (nextDefault) {
        const allowedIds = updates.allowedDemoIds ?? agent.allowedDemoIds ?? []
        const story = await Models.Story.findOne({
          _id: nextDefault,
          workspaceId,
          deletedAt: null,
        }).select('_id').lean()
        if (!story) {
          httpError(ResponseCodes['400_BAD_REQUEST'], 'defaultDemoId must be a story of this workspace')
        }
        if (allowedIds.length && !allowedIds.some(id => String(id) === String(nextDefault))) {
          httpError(ResponseCodes['400_BAD_REQUEST'], 'defaultDemoId must be in allowedDemoIds')
        }
      }
      updates.defaultDemoId = nextDefault
    }

    if (body.qualification !== undefined) {
      try {
        updates.qualification = normalizeQualification(body.qualification)
      } catch (err) {
        if (!err.isValidation) throw err
        httpError(ResponseCodes['400_BAD_REQUEST'], err.message)
      }
    }
    if (body.recapEnabled !== undefined) updates.recapEnabled = !!body.recapEnabled
    try {
      Object.assign(updates, normalizeSummarySettings(body))
    } catch (err) {
      if (!err.isValidation) throw err
      httpError(ResponseCodes['400_BAD_REQUEST'], err.message)
    }

    if (body.embed !== undefined) {
      Object.assign(updates, await embedPatchUpdates(Models, agent, authUser, body.embed))
    }

    const updated = await Models.AiDemoAgent.findOneAndUpdate(
      { _id: agent._id },
      { $set: updates },
      { new: true, lean: true }
    )

    sendJson(res, updated)
  } catch (error) {
    sendError(res, error)
  }
}

export default handler
