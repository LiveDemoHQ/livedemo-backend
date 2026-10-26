import helpers from '../helpers/livedemoHelpers.js'
import loadAgentInWorkspace from '../helpers/agent/loadAgentInWorkspace.js'
import enqueueIndexAgentKnowledge from '../helpers/agent/enqueueIndexJob.js'
import { faqToText, stripHtml } from '../helpers/agent/agentKnowledge.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { sendJson, sendError, httpError } from '../helpers/agent/http.js'
import { assertPublicUrl } from '../helpers/agent/publicUrl.js'
import { MAX_PAGES_CAP } from '../helpers/agent/siteCrawler.js'

import logger from '../helpers/logger.js'

// POST /workspaces/:workspaceId/agents/:agentId/knowledge
// JSON:      { type: 'text'|'faq'|'url'|'site'|'call', title, rawText | faq: [{q,a}] | url }
//            site: { url, maxPages?, refreshHours? } crawls the whole site (siteCrawler.js)
//            call: { rawText } sales-call transcript, used for phrasing only
// multipart: { type: 'file', file } (pdf, md, txt, html)
// Optional chunks: [{ text, embedding, metadata: { title, url } }] (JSON string in multipart) stores
// already-embedded chunks (livedemo-cursor import-prod) and skips indexing
//
// PDFs ≤4MB: base64 stored for native gemini-embedding-2 embed (≤6 pages).
// Larger or multi-page PDFs: text extraction + chunked text embeddings.
const PDF_MAX_STORE_BYTES = 4 * 1024 * 1024
const EMBED_DIMS = 768
const MAX_IMPORTED_CHUNKS = 5000

// Embeddings from another env only match here if it used the same model + dims
export function importedChunks(value) {
  let chunks = value
  if (typeof value === 'string') {
    try {
      chunks = JSON.parse(value)
    } catch (err) {
      httpError(ResponseCodes['400_BAD_REQUEST'], 'chunks must be JSON')
    }
  }
  if (!Array.isArray(chunks) || !chunks.length || chunks.length > MAX_IMPORTED_CHUNKS) {
    httpError(ResponseCodes['400_BAD_REQUEST'], `chunks must be 1-${MAX_IMPORTED_CHUNKS} items`)
  }
  return chunks.map(chunk => {
    if (typeof chunk?.text !== 'string' || !Array.isArray(chunk.embedding) || chunk.embedding.length !== EMBED_DIMS || !chunk.embedding.every(Number.isFinite)) {
      httpError(ResponseCodes['400_BAD_REQUEST'], `each chunk needs text and a ${EMBED_DIMS}-number embedding`)
    }
    const metadata = chunk.metadata || {}
    return {
      text: chunk.text,
      embedding: chunk.embedding,
      metadata: { title: metadata.title ? String(metadata.title) : undefined, url: metadata.url ? String(metadata.url) : undefined },
    }
  })
}

async function extractFileText(file) {
  const name = (file.originalname || '').toLowerCase()
  const isPdf = name.endsWith('.pdf') || file.mimetype === 'application/pdf'

  if (isPdf) {
    const { default: pdfParse } = await import('pdf-parse')
    const parsed = await pdfParse(file.buffer)
    return {
      text: parsed.text || '',
      pageCount: parsed.numpages || 0,
      isPdf: true,
      fileBase64: file.buffer.length <= PDF_MAX_STORE_BYTES
        ? file.buffer.toString('base64')
        : '',
    }
  }

  const text = file.buffer.toString('utf8')
  if (name.endsWith('.html') || name.endsWith('.htm') || file.mimetype === 'text/html') {
    return { text: stripHtml(text), pageCount: 0, isPdf: false, fileBase64: '' }
  }

  return { text, pageCount: 0, isPdf: false, fileBase64: '' }
}

const handler = async function (req, res) {
  const { Models } = req.mongo
  const { workspaceId, agentId } = req.params
  const body = req.body || {}

  try {
    const { authUser } = await helpers.authReq(req, Models)
    helpers.validateUserHasAccessToWorkspace(authUser, workspaceId)

    const agent = await loadAgentInWorkspace(Models, workspaceId, agentId)

    const type = body.type
    const sourceObj = {
      agentId: agent._id,
      workspaceId: agent.workspaceId,
      type,
      title: body.title || '',
      status: 'pending',
    }

    if (type === 'text') {
      if (!body.rawText) httpError(ResponseCodes['400_BAD_REQUEST'], 'rawText is required')
      sourceObj.rawText = body.rawText
    } else if (type === 'faq') {
      const faqPairs = typeof body.faq === 'string' ? JSON.parse(body.faq) : body.faq
      sourceObj.rawText = body.rawText || faqToText(faqPairs)
      if (!sourceObj.rawText) httpError(ResponseCodes['400_BAD_REQUEST'], 'faq pairs are required')
    } else if (type === 'call') {
      if (!body.rawText) httpError(ResponseCodes['400_BAD_REQUEST'], 'rawText is required')
      sourceObj.rawText = String(body.rawText).slice(0, 500000)
      if (!sourceObj.title) sourceObj.title = 'Sales call transcript'
    } else if (type === 'url' || type === 'site') {
      if (!body.url) httpError(ResponseCodes['400_BAD_REQUEST'], 'url is required')
      const url = await assertPublicUrl(body.url).catch(err => httpError(ResponseCodes['400_BAD_REQUEST'], err.message))
      sourceObj.url = url.toString()
      if (!sourceObj.title) sourceObj.title = sourceObj.url
      if (body.refreshHours !== undefined) {
        const hours = Number(body.refreshHours)
        if (!Number.isInteger(hours) || hours < 0 || hours > 24 * 30) httpError(ResponseCodes['400_BAD_REQUEST'], 'refreshHours must be 0-720')
        sourceObj.refreshHours = hours
      }
      if (type === 'site' && body.maxPages !== undefined) {
        const maxPages = Number(body.maxPages)
        if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES_CAP) httpError(ResponseCodes['400_BAD_REQUEST'], `maxPages must be 1-${MAX_PAGES_CAP}`)
        sourceObj.maxPages = maxPages
      }
    } else if (type === 'file') {
      if (!req.file) httpError(ResponseCodes['400_BAD_REQUEST'], 'file is required')
      const extracted = await extractFileText(req.file)
      sourceObj.rawText = extracted.text
      sourceObj.fileName = req.file.originalname
      sourceObj.mimeType = req.file.mimetype
      sourceObj.pageCount = extracted.pageCount || 0
      if (extracted.fileBase64) sourceObj.fileBase64 = extracted.fileBase64
      if (!sourceObj.title) sourceObj.title = req.file.originalname
    } else {
      // 'demo' sources are created by the Demos tab (patchAgent), never here
      httpError(ResponseCodes['400_BAD_REQUEST'], 'Invalid source type')
    }

    const chunks = body.chunks !== undefined ? importedChunks(body.chunks) : null
    if (chunks) {
      sourceObj.status = 'ready'
      sourceObj.chunkCount = chunks.length
      // Keeps the refresh scheduler from re-crawling (and re-embedding) right away
      if (type === 'url' || type === 'site') sourceObj.lastCrawledAt = new Date()
    }
    const source = new Models.AgentKnowledgeSource(sourceObj)
    if (chunks) {
      await Models.AgentKnowledgeChunk.insertMany(chunks.map(chunk => ({
        ...chunk,
        agentId: agent._id,
        workspaceId: agent.workspaceId,
        sourceId: source._id,
        sourceType: type,
      })))
    }
    await source.save()
    await Models.AiDemoAgent.updateOne(
      { _id: agent._id },
      { $addToSet: { knowledgeSourceIds: source._id } }
    )

    if (!chunks) {
      enqueueIndexAgentKnowledge(agent._id, source._id)
        .catch(err => logger.error('enqueue indexAgentKnowledge failed', { eventName: 'ENQUEUE_INDEXAGENTKNOWLEDGE_FAILED', err: err }))
    }

    sendJson(res, source)
  } catch (error) {
    sendError(res, error)
  }
}

export default handler
