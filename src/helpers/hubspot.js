import axios from 'axios'
import mongoose from 'mongoose'
import helpers from './livedemoHelpers.js'

const { ObjectId } = mongoose.Types
const API = 'https://api.hubapi.com'
const NOTE_TO_CONTACT = 202 // HUBSPOT_DEFINED association type id

// Shared by story leads (processDemoActivityEvents) and agent leads (processAgentSession).

// null when the workspace has no HubSpot connection
export async function getHubspotAccessToken(Models, workspaceId) {
    const workspace = await Models.Workspace.findOne({ _id: workspaceId }).select('integrations').lean()
    if (!workspace || !workspace.integrations || !workspace.integrations.hubspot) return null

    const token = await Models.HubspotToken.findOne({ workspaceId: new ObjectId(String(workspaceId)) }).lean()
    if (!token || !token.accessToken) return null
    if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
        try {
            return (await helpers.refreshHubspotToken(token, Models)).accessToken
        } catch (err) {
            console.log('HubSpot token refresh failed', err.message)
        }
    }
    return token.accessToken
}

function splitName(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
    return { firstname: parts[0] || '', lastname: parts.slice(1).join(' ') }
}

// Create, or find the existing contact on 409. Returns the contact id.
export async function upsertHubspotContact(accessToken, { email, name }) {
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    const { firstname, lastname } = splitName(name)
    const properties = { email }
    if (firstname) properties.firstname = firstname
    if (lastname) properties.lastname = lastname

    try {
        const res = await axios.post(`${API}/crm/v3/objects/contacts`, { properties }, { headers })
        return res.data.id
    } catch (err) {
        if (!err.response || err.response.status !== 409) throw err
        const match = String(err.response.data && err.response.data.message).match(/Existing ID:\s*(\d+)/)
        if (match) return match[1]
        const search = await axios.post(`${API}/crm/v3/objects/contacts/search`, {
            filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
            limit: 1
        }, { headers })
        return search.data.results && search.data.results[0] ? search.data.results[0].id : null
    }
}

export async function createHubspotNote(accessToken, contactId, html) {
    await axios.post(`${API}/crm/v3/objects/notes`, {
        properties: { hs_timestamp: new Date().toISOString(), hs_note_body: html },
        associations: [{
            to: { id: contactId },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO_CONTACT }]
        }]
    }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } })
}

const escapeHtml = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// `data` = workspaceEvents.sessionPayload(); demos = [{ name }]
export function agentSessionNoteHtml(data, demos = []) {
    const s = data.session
    const facts = Object.entries(s.fields || {}).filter(([key]) => !['name', 'email'].includes(key))
    const rows = [
        `<p><strong>LiveDemo AI agent conversation</strong> · ${escapeHtml(s.agentName)}</p>`,
        s.summary ? `<p>${escapeHtml(s.summary)}</p>` : '',
        s.intent ? `<p><strong>Intent:</strong> ${escapeHtml(s.intent)}${s.qualified ? ' · <strong>Qualified</strong>' : ''}</p>` : '',
        s.topics.length ? `<p><strong>Topics:</strong> ${s.topics.map(escapeHtml).join(', ')}</p>` : '',
        facts.length ? `<ul>${facts.map(([key, value]) => `<li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</li>`).join('')}</ul>` : '',
        demos.length ? `<p><strong>Demos watched:</strong> ${demos.map(d => escapeHtml(d.name || 'Untitled demo')).join(', ')}</p>` : '',
        s.unanswered.length ? `<p><strong>Could not answer:</strong> ${s.unanswered.map(escapeHtml).join(' · ')}</p>` : '',
        `<p><a href="${escapeHtml(s.replayUrl)}">Session replay</a>${s.recapUrl ? ` · <a href="${escapeHtml(s.recapUrl)}">Recap page</a>` : ''}</p>`
    ]
    return rows.filter(Boolean).join('')
}
