import helpers from '../helpers/livedemoHelpers.js'
import aiHelpers from '../helpers/aiHelpers.js'
import loadAgentInWorkspace from '../helpers/agent/loadAgentInWorkspace.js'
import retrieve from '../helpers/agent/retrieve.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'

// Editor-only knowledge tooling:
//   GET  /workspaces/:workspaceId/agents/:agentId/knowledge/:sourceId/preview  what the agent actually reads
//   GET  /workspaces/:workspaceId/agents/:agentId/knowledge-gaps?days=7        unanswered questions, grouped
//   POST /workspaces/:workspaceId/agents/:agentId/knowledge-gaps/draft         { question } -> { q, a } FAQ draft

const THIN_PAGE_CHARS = 300
const PREVIEW_CHUNKS = 300
const GAP_QUESTIONS = 300

async function loadAgent(req) {
    const { Models } = req.mongo
    const { workspaceId, agentId } = req.params
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, workspaceId)
    return { Models, agent: await loadAgentInWorkspace(Models, workspaceId, agentId) }
}

const wrap = fn => (req, res) => fn(req, res).catch(error => sendError(res, error))

const preview = wrap(async (req, res) => {
    const { Models, agent } = await loadAgent(req)
    const source = await Models.AgentKnowledgeSource.findOne({ _id: req.params.sourceId, agentId: agent._id })
        .select('-fileBase64 -rawText')
        .lean()
    if (!source) httpError(ResponseCodes['404_NOT_FOUND'], 'Knowledge source not found')

    const chunks = await Models.AgentKnowledgeChunk.find({ sourceId: source._id, agentId: agent._id })
        .select('text metadata')
        .sort({ _id: 1 })
        .limit(PREVIEW_CHUNKS)
        .lean()

    // One entry per page (site) or a single entry (everything else)
    const byUrl = new Map()
    chunks.forEach((chunk) => {
        const url = (chunk.metadata && chunk.metadata.url) || source.url || ''
        if (!byUrl.has(url)) byUrl.set(url, { url, title: (chunk.metadata && chunk.metadata.title) || source.title || url, text: [] })
        byUrl.get(url).text.push(chunk.text)
    })
    const pages = [...byUrl.values()].map(page => ({ ...page, text: page.text.join('\n\n'), chars: page.text.join('').length }))
    const crawled = (source.pages || []).filter(p => !byUrl.has(p.url)).map(p => ({ url: p.url, title: p.title, text: '', chars: p.chars || 0 }))
    const all = [...pages, ...crawled]

    sendJson(res, {
        source: {
            _id: source._id,
            type: source.type,
            title: source.title,
            url: source.url,
            status: source.status,
            lastCrawledAt: source.lastCrawledAt || null
        },
        pages: all,
        totalChars: all.reduce((sum, p) => sum + p.chars, 0),
        thinPages: all.filter(p => p.chars < THIN_PAGE_CHARS).map(p => p.url || p.title),
        truncated: chunks.length === PREVIEW_CHUNKS
    })
})

const GAP_SCHEMA = {
    type: 'object',
    properties: {
        groups: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    topic: { type: 'string' },
                    question: { type: 'string', description: 'One canonical FAQ-style question for the group' },
                    indexes: { type: 'array', items: { type: 'integer' } }
                },
                required: ['topic', 'question', 'indexes']
            }
        }
    },
    required: ['groups']
}

const gaps = wrap(async (req, res) => {
    const { Models, agent } = await loadAgent(req)
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90)
    const since = Date.now() - days * 24 * 60 * 60 * 1000

    const sessions = await Models.AgentSession.find({
        agentId: agent._id,
        workspaceId: agent.workspaceId,
        mode: 'published',
        startTimestamp: { $gt: since },
        'unanswered.0': { $exists: true }
    }).select('_id unanswered').sort({ startTimestamp: -1 }).limit(1000).lean()

    const questions = sessions
        .flatMap(s => (s.unanswered || []).map(q => ({ q: String(q).slice(0, 300), sessionId: String(s._id) })))
        .slice(0, GAP_QUESTIONS)
    if (!questions.length) return sendJson(res, { days, totalQuestions: 0, groups: [] })

    let groups
    try {
        const prompt = [
            'Group these visitor questions that a product\'s AI agent could not answer into topics. Merge near-duplicates. Every index must appear in exactly one group.',
            'Write each topic as 2-5 words and one canonical FAQ question per group.',
            '',
            ...questions.map((item, i) => `${i}. ${item.q}`)
        ].join('\n')
        const result = await aiHelpers.generateJson(prompt, GAP_SCHEMA)
        groups = (result.groups || []).map((g) => {
            const items = [...new Set(g.indexes || [])].filter(i => questions[i]).map(i => questions[i])
            return {
                topic: String(g.topic || '').slice(0, 80),
                question: String(g.question || '').slice(0, 300),
                count: items.length,
                sessions: [...new Set(items.map(item => item.sessionId))].length,
                examples: items.slice(0, 5).map(item => item.q),
                sessionIds: [...new Set(items.map(item => item.sessionId))].slice(0, 10)
            }
        }).filter(g => g.count)
    } catch (err) {
        // ponytail: Gemini down -> exact-match grouping; good enough to not lose the report
        console.log('knowledge gaps grouping failed', err.message)
        const exact = new Map()
        questions.forEach((item) => {
            const key = item.q.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
            if (!exact.has(key)) exact.set(key, { topic: item.q.slice(0, 80), question: item.q, items: [] })
            exact.get(key).items.push(item)
        })
        groups = [...exact.values()].map(g => ({
            topic: g.topic,
            question: g.question,
            count: g.items.length,
            sessions: new Set(g.items.map(item => item.sessionId)).size,
            examples: g.items.slice(0, 5).map(item => item.q),
            sessionIds: [...new Set(g.items.map(item => item.sessionId))].slice(0, 10)
        }))
    }

    groups.sort((a, b) => b.count - a.count)
    sendJson(res, { days, totalQuestions: questions.length, groups })
})

const DRAFT_SCHEMA = {
    type: 'object',
    properties: {
        q: { type: 'string' },
        a: { type: 'string' },
        grounded: { type: 'boolean', description: 'true when the answer is fully supported by the context' }
    },
    required: ['q', 'a', 'grounded']
}

const draftFaq = wrap(async (req, res) => {
    const { Models, agent } = await loadAgent(req)
    const question = String((req.body && req.body.question) || '').trim().slice(0, 300)
    if (!question) httpError(ResponseCodes['400_BAD_REQUEST'], 'question is required')

    const { knowledge } = await retrieve(Models, { agent, queryText: question })
    const prompt = [
        'Draft one FAQ entry for a product knowledge base. The author will review and edit it before saving.',
        'Use ONLY the context below. Where the context does not cover something, write [fill in: ...] placeholders instead of guessing.',
        'Answer in 1-4 short sentences, in a helpful product voice.',
        '',
        `Visitor question: ${question}`,
        '',
        'Context:',
        ...(knowledge.length ? knowledge.map((c, i) => `[${i + 1}] ${String(c.text).slice(0, 1200)}`) : ['(none)'])
    ].join('\n')
    const draft = await aiHelpers.generateJson(prompt, DRAFT_SCHEMA)
    sendJson(res, {
        q: String(draft.q || question).slice(0, 300),
        a: String(draft.a || '').slice(0, 2000),
        grounded: !!draft.grounded
    })
})

export default {
    preview,
    gaps,
    draftFaq
}
