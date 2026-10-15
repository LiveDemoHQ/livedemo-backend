import moment from 'moment'
import { allFields, coerceValue, isQualified, writeField } from './qualification.js'
import { buildPersonalization } from './personalization.js'
import { emitSafe, sessionPayload } from '../workspaceEvents.js'

// One write path for visitor facts, whoever learned them: the record_field
// tool (self_reported), the summary job (extracted) or the host page (host).
// Handles lead creation, personalization, qualification + their events.
// Returns { session, recorded: [keys], qualifiedNow }.
export default async function applySessionFields(Models, { agent, session, values, source, mode }) {
    const known = allFields(agent)
    let fields = { ...(session.fields || {}) }
    const recorded = []

    Object.entries(values || {}).forEach(([key, raw]) => {
        const field = known.find(f => f.key === key)
        if (!field) return
        const value = coerceValue(field, raw)
        if (value === undefined) return
        const next = writeField(fields, key, value, source)
        if (!next) return
        fields = next
        recorded.push(key)
    })
    if (!recorded.length) return { session, recorded, qualifiedNow: false }

    const flat = key => fields[key] && fields[key].value
    const personalization = buildPersonalization(session.personalization, {
        name: flat('name') || session.visitorName,
        email: flat('email') || session.visitorEmail,
        company: flat('company')
    })
    const qualifiedNow = !session.qualified && isQualified(agent, fields)
    const now = new Date()

    const $set = { fields, personalization }
    if (recorded.includes('email')) $set.visitorEmail = flat('email')
    if (recorded.includes('name')) $set.visitorName = flat('name')
    if (qualifiedNow) {
        $set.qualified = true
        $set.qualifiedAt = now
    }

    const published = mode === 'published'
    let leadId = session.leadId
    let leadCreated = false
    if (published && !leadId && flat('email')) {
        const lead = await new Models.Lead({
            workspaceId: agent.workspaceId,
            agentId: agent._id,
            agentSessionId: session._id,
            capturedVia: 'chat',
            data: { name: flat('name') || session.visitorName || '', email: flat('email') }
        }).save()
        leadId = lead._id
        leadCreated = true
        $set.leadId = leadId
    }

    const updated = await Models.AgentSession.findOneAndUpdate({ _id: session._id }, { $set }, { new: true, lean: true })

    if (published && leadId) {
        const leadSet = recorded.reduce((acc, key) => ({ ...acc, [`data.${key}`]: flat(key) }), {})
        if (qualifiedNow) leadSet.qualified = true
        await Models.Lead.updateOne({ _id: leadId }, { $set: leadSet })
    }

    const timestamp = moment().valueOf()
    await Models.AgentSessionEvent.insertMany([
        { sessionId: session._id, workspaceId: agent.workspaceId, agentId: agent._id, type: 'field_recorded', timestamp, data: { keys: recorded, source } },
        ...(qualifiedNow ? [{ sessionId: session._id, workspaceId: agent.workspaceId, agentId: agent._id, type: 'qualified', timestamp, data: {} }] : [])
    ])

    if (published && (leadCreated || qualifiedNow)) {
        const lead = leadId ? await Models.Lead.findById(leadId).lean() : null
        const data = sessionPayload({ session: updated, agent, lead })
        if (leadCreated) emitSafe(Models, agent.workspaceId, 'lead.created', data)
        if (qualifiedNow) emitSafe(Models, agent.workspaceId, 'lead.qualified', data)
    }

    return { session: updated, recorded, qualifiedNow }
}
