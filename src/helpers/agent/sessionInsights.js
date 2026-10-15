import aiHelpers from '../aiHelpers.js'
import applySessionFields from './sessionFields.js'
import { missingFields } from './qualification.js'
import { emitSafe, sessionPayload } from '../workspaceEvents.js'
import { agentSessionNoteHtml, createHubspotNote, getHubspotAccessToken, upsertHubspotContact } from '../hubspot.js'
import { sendSummaryEmail } from './summaryEmail.js'

// summarizeAgentSession job body. Mid-session runs (final: false) only refresh
// summary/topics so long chats keep context past HISTORY_LIMIT. The final run
// also fires session.ended + the HubSpot contact/note, exactly once per session.

const TRANSCRIPT_CHARS = 24000

const emailsVisitor = agent => !!(agent.summaryEmail && agent.summaryEmail.enabled)

function buildPrompt(agent, messages, missing) {
    const transcript = messages
        .map(m => `${m.role === 'user' ? 'Visitor' : 'Agent'}: ${m.content}`)
        .join('\n')
        .slice(-TRANSCRIPT_CHARS)
    const lines = [
        `You review a conversation between a website visitor and "${agent.name || 'the AI demo agent'}", an AI agent that answers product questions and shows demos.`,
        'Return JSON:',
        '- summary: 2-3 sentences for a sales rep: who the visitor is, what they need, what they saw, what is next.',
        '- topics: up to 6 short product topics discussed (2-4 words each).',
        '- intent: buying intent. high = asked about pricing/rollout/timeline/trial or wants to talk to sales; medium = evaluating features; low = browsing or off-topic.',
        '- unanswered: visitor questions the agent did not actually answer (said it does not know, deflected, or stayed vague). Rewrite each as a standalone question. Empty if none.'
    ]
    if (emailsVisitor(agent)) {
        lines.push('- visitorSummary: 2-4 sentences written TO the visitor (second person, friendly, no sales jargon): what they asked about, the key answers, the demos they saw. Never mention intent, qualification or internal notes.')
    }
    if (missing.length) {
        lines.push('- fields: values the visitor clearly stated in the transcript, keyed by field. Omit a key when not stated. Fields:')
        missing.forEach(f => lines.push(`  ${f.key} (${f.type}${f.options && f.options.length ? `: ${f.options.join(' | ')}` : ''}): ${f.label}`))
    }
    lines.push('\nTranscript:', transcript)
    return lines.join('\n')
}

function schemaFor(agent, missing) {
    const schema = {
        type: 'object',
        properties: {
            summary: { type: 'string' },
            topics: { type: 'array', items: { type: 'string' } },
            intent: { type: 'string', enum: ['low', 'medium', 'high'] },
            unanswered: { type: 'array', items: { type: 'string' } }
        },
        required: ['summary', 'topics', 'intent', 'unanswered']
    }
    if (emailsVisitor(agent)) {
        schema.properties.visitorSummary = { type: 'string' }
        schema.required.push('visitorSummary')
    }
    if (missing.length) {
        schema.properties.fields = {
            type: 'object',
            properties: missing.reduce((acc, f) => ({ ...acc, [f.key]: { type: f.type === 'number' ? 'number' : f.type === 'boolean' ? 'boolean' : 'string' } }), {})
        }
    }
    return schema
}

async function syncHubspot(Models, { agent, session, data }) {
    const email = data.lead && data.lead.email
    if (!email) return
    const accessToken = await getHubspotAccessToken(Models, agent.workspaceId)
    if (!accessToken) return

    const contactId = await upsertHubspotContact(accessToken, { email, name: data.lead.name })
    if (!contactId) return
    if (session.leadId) await Models.Lead.updateOne({ _id: session.leadId }, { $set: { hubspotContactId: String(contactId) } })

    const demos = (session.viewedDemoIds || []).length
        ? await Models.Story.find({ _id: { $in: session.viewedDemoIds } }).select('name').lean()
        : []
    await createHubspotNote(accessToken, contactId, agentSessionNoteHtml(data, demos))
}

export default async function summarizeAgentSession(Models, { sessionId, final }) {
    let session = await Models.AgentSession.findById(sessionId).lean()
    if (!session) return
    const agent = await Models.AiDemoAgent.findById(session.agentId).lean()
    if (!agent) return

    const messages = await Models.AgentMessage.find({ sessionId }).sort({ _id: 1 }).select('role content').lean()
    const fresh = messages.length > (session.summarizedMessageCount || 0)

    if (messages.length && fresh) {
        const missing = missingFields(agent, session.fields)
        const out = await aiHelpers.generateJson(buildPrompt(agent, messages, missing), schemaFor(agent, missing))
        session = await Models.AgentSession.findOneAndUpdate({ _id: sessionId }, {
            $set: {
                summary: String(out.summary || '').slice(0, 1200),
                topics: (out.topics || []).map(t => String(t).slice(0, 60)).slice(0, 6),
                intent: ['low', 'medium', 'high'].includes(out.intent) ? out.intent : 'low',
                unanswered: (out.unanswered || []).map(q => String(q).slice(0, 300)).slice(0, 10),
                ...(out.visitorSummary ? { visitorSummary: String(out.visitorSummary).slice(0, 1200) } : {}),
                summarizedAt: new Date(),
                summarizedMessageCount: messages.length
            }
        }, { new: true, lean: true })
        if (out.fields && Object.keys(out.fields).length) {
            const applied = await applySessionFields(Models, { agent, session, values: out.fields, source: 'extracted', mode: session.mode })
            session = applied.session
        }
    }

    if (!final || session.mode !== 'published') return

    // Claim the finalize step so retries / the idle sweep never double-send
    const claimed = await Models.AgentSession.findOneAndUpdate(
        { _id: sessionId, finalizedAt: null },
        { $set: { finalizedAt: new Date() } },
        { new: true, lean: true }
    )
    if (!claimed) return

    const lead = claimed.leadId ? await Models.Lead.findById(claimed.leadId).lean() : null
    const data = sessionPayload({ session: claimed, agent, lead })
    if (messages.length) emitSafe(Models, agent.workspaceId, 'session.ended', data)
    await syncHubspot(Models, { agent, session: claimed, data })
        .catch(err => console.log('HubSpot agent sync failed', err.response?.data || err.message))
    if (messages.length) {
        await sendSummaryEmail(Models, { agent, session: claimed, lead })
            .catch(err => console.log('Summary email failed', err.message))
    }
}
