import OpenAI from "openai"
import ENV from '../envServer.js'
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { GoogleGenAI } from '@google/genai'

const openai = new OpenAI({
    apiKey: ENV.OPENAI_API_KEY,
})

const genai = ENV.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: String(ENV.GEMINI_API_KEY).trim() })
    : null

const GEMINI_MODEL = ENV.GEMINI_MODEL || 'gemini-3.5-flash-lite'
// https://ai.google.dev/gemini-api/docs/embeddings
const GEMINI_EMBED_MODEL = ENV.GEMINI_EMBED_MODEL || 'gemini-embedding-2'
const GEMINI_EMBED_DIMS = 768
const EMBED_MIN_INTERVAL_MS = Number(ENV.GEMINI_EMBED_MIN_INTERVAL_MS) || 200
const EMBED_MAX_RETRIES = Number(ENV.GEMINI_EMBED_MAX_RETRIES) || 5
const EMBED_BATCH_SIZE = 100
const PDF_MAX_NATIVE_PAGES = 6

let lastEmbedAt = 0

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function isRateLimitError(err) {
    return err?.status === 429
        || err?.code === 429
        || /429|RESOURCE_EXHAUSTED|quota exceeded/i.test(String(err?.message || err))
}

const GEMINI_EMBED_QUERY_TASK = ENV.GEMINI_EMBED_QUERY_TASK || 'QUESTION_ANSWERING'

// gemini-embedding-2: task instructions in the prompt (not taskType config field).
const QUERY_TASK_PREFIX = {
  RETRIEVAL_QUERY: 'search result',
  SEARCH: 'search result',
  QUESTION_ANSWERING: 'question answering',
  FACT_VERIFICATION: 'fact checking',
  FACT_CHECKING: 'fact checking',
  CODE_RETRIEVAL_QUERY: 'code retrieval',
}

// Symmetric tasks: same format for query and document (not for retrieval search).
const SYMMETRIC_TASK_PREFIX = {
  SEMANTIC_SIMILARITY: 'sentence similarity',
  CLASSIFICATION: 'classification',
  CLUSTERING: 'clustering',
}

function isDocumentEmbed(options = {}) {
  return options.role === 'document' || options.taskType === 'RETRIEVAL_DOCUMENT'
}

function resolveEmbedTaskType(options = {}) {
  if (options.taskType) return options.taskType
  if (isDocumentEmbed(options)) return 'RETRIEVAL_DOCUMENT'
  return GEMINI_EMBED_QUERY_TASK
}

function formatEmbedDocument(text, title) {
  const clean = String(text || '').trim()
  return `title: ${title || 'none'} | text: ${clean}`
}

function formatEmbedQuery(text, taskType) {
  const clean = String(text || '').trim()
  const symmetric = SYMMETRIC_TASK_PREFIX[taskType]
  if (symmetric) {
    return `task: ${symmetric} | query: ${clean}`
  }
  const prefix = QUERY_TASK_PREFIX[taskType] || QUERY_TASK_PREFIX.RETRIEVAL_QUERY
  return `task: ${prefix} | query: ${clean}`
}

function formatEmbedInput(text, options = {}) {
  const clean = String(text || '').trim()
  const taskType = resolveEmbedTaskType(options)
  if (isDocumentEmbed(options)) {
    return formatEmbedDocument(clean, options.title)
  }
  return formatEmbedQuery(clean, taskType)
}

function buildEmbedConfig() {
  return { outputDimensionality: GEMINI_EMBED_DIMS }
}

function parseEmbedResponse(res, expectedCount = 1) {
    const raw = (res.embeddings && res.embeddings.length)
        ? res.embeddings.map(e => e.values)
        : (res.embedding?.values ? [res.embedding.values] : [])
    if (!raw.length) {
        throw new Error('No embeddings returned from embedContent')
    }
    if (expectedCount > 1 && raw.length !== expectedCount) {
        throw new Error(`Expected ${expectedCount} embeddings, got ${raw.length}`)
    }
    return raw
}

async function throttleEmbed() {
    const wait = EMBED_MIN_INTERVAL_MS - (Date.now() - lastEmbedAt)
    if (wait > 0) await sleep(wait)
    lastEmbedAt = Date.now()
}

async function callEmbed(text, options = {}) {
    const res = await genai.models.embedContent({
        model: GEMINI_EMBED_MODEL,
        contents: formatEmbedInput(text, options),
        config: buildEmbedConfig(),
    })
    return parseEmbedResponse(res, 1)[0]
}

// Content[] → one embedding per item (not aggregated)
async function callEmbedBatch(texts, options = {}) {
    const contents = texts.map(t => ({
        parts: [{ text: formatEmbedInput(t, options) }],
    }))
    const res = await genai.models.embedContent({
        model: GEMINI_EMBED_MODEL,
        contents,
        config: buildEmbedConfig(),
    })
    return parseEmbedResponse(res, texts.length)
}

// One round of the agent tool loop (see helpers/agent/agentTools.js). Mode ANY
// forces a function call; returns the raw response (functionCalls, candidates).
async function generateAgentStep(contents, { tools, allowedFunctionNames }) {
    if (!genai) {
        throw new Error('GEMINI_API_KEY is not configured')
    }

    return genai.models.generateContent({
        model: GEMINI_MODEL,
        config: {
            thinkingConfig: { thinkingLevel: 'MINIMAL' },
            tools: [{ functionDeclarations: tools }],
            toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames } },
        },
        contents,
    })
}

// One structured-output call (summaries, gap clustering, FAQ drafts). Returns the parsed object.
async function generateJson(prompt, schema) {
    if (!genai) {
        throw new Error('GEMINI_API_KEY is not configured')
    }

    const res = await genai.models.generateContent({
        model: GEMINI_MODEL,
        config: {
            thinkingConfig: { thinkingLevel: 'MINIMAL' },
            responseMimeType: 'application/json',
            responseJsonSchema: schema,
        },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
    })
    return JSON.parse(res.text || '{}')
}

// gemini-embedding-2: prompt task prefixes; batch via Content[] per docs.
async function embedPdfDocument(pdfBase64, options = {}) {
    if (!genai) {
        throw new Error('GEMINI_API_KEY is not configured')
    }
    const data = String(pdfBase64 || '').trim()
    if (!data) {
        throw new Error('PDF data is required')
    }

    for (let attempt = 0; attempt <= EMBED_MAX_RETRIES; attempt++) {
        await throttleEmbed()
        try {
            // Multimodal PDF: no task prefix on the PDF itself (per embeddings docs)
            const res = await genai.models.embedContent({
                model: GEMINI_EMBED_MODEL,
                contents: [{
                    inlineData: {
                        mimeType: 'application/pdf',
                        data,
                    },
                }],
                config: buildEmbedConfig(),
            })
            return parseEmbedResponse(res, 1)[0]
        } catch (err) {
            if (!isRateLimitError(err) || attempt === EMBED_MAX_RETRIES) throw err
            const delay = Math.min(60000, 2000 * (2 ** attempt))
            console.log(`embedPdf 429, retry ${attempt + 1}/${EMBED_MAX_RETRIES} in ${delay}ms`)
            await sleep(delay)
        }
    }
}

async function embedText(text, options = {}) {
    if (!genai) {
        throw new Error('GEMINI_API_KEY is not configured')
    }

    for (let attempt = 0; attempt <= EMBED_MAX_RETRIES; attempt++) {
        // live = a visitor is waiting on this query; the throttle is for indexing jobs
        if (!options.live || attempt > 0) await throttleEmbed()
        try {
            return await callEmbed(text, options)
        } catch (err) {
            if (!isRateLimitError(err) || attempt === EMBED_MAX_RETRIES) throw err
            const delay = Math.min(60000, 2000 * (2 ** attempt))
            console.log(`embedText 429, retry ${attempt + 1}/${EMBED_MAX_RETRIES} in ${delay}ms`)
            await sleep(delay)
        }
    }
}

async function embedBatchWithRetry(texts, options = {}) {
    if (!genai) {
        throw new Error('GEMINI_API_KEY is not configured')
    }
    if (!texts.length) return []

    for (let attempt = 0; attempt <= EMBED_MAX_RETRIES; attempt++) {
        await throttleEmbed()
        try {
            return await callEmbedBatch(texts, options)
        } catch (err) {
            if (!isRateLimitError(err) || attempt === EMBED_MAX_RETRIES) {
                // If batch not supported on this endpoint/model, fallback to sequential
                if (/batch|multiple|supports one content/i.test(String(err?.message || ''))) {
                    console.log('Batch embedding not supported by endpoint, falling back to sequential')
                    const sequential = []
                    for (const text of texts) {
                        sequential.push(await embedText(text, options))
                    }
                    return sequential
                }
                throw err
            }
            const delay = Math.min(60000, 2000 * (2 ** attempt))
            console.log(`embedBatch 429, retry ${attempt + 1}/${EMBED_MAX_RETRIES} in ${delay}ms`)
            await sleep(delay)
        }
    }
}

// Batch embed for indexing jobs (drastically reduces API calls and avoids 429s).
async function embedTexts(texts, options = {}) {
    if (!texts || !texts.length) return []
    const out = []
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
        const batch = texts.slice(i, i + EMBED_BATCH_SIZE)
        const batchVectors = await embedBatchWithRetry(batch, options)
        out.push(...batchVectors)
    }
    return out
}


const elevenlabs = new ElevenLabsClient({
    apiKey: ENV.ELEVENLABS_API_KEY
});
// Every backend TTS call. Lowest latency; the API default (multilingual_v2) is several times slower.
const ELEVENLABS_TTS_MODEL = 'eleven_flash_v2_5'

function query3_5(message) {
    return openai.chat.completions.create({
        model: "gpt-3.5-turbo-16k",
        messages: [{"role": "system", "content": message}],
        temperature: 0.5,
    })
        .then(response => {
            console.log(response.choices[0].message.content)

            return response.choices[0].message.content
        })
        .catch(err => {

            console.log(err)
            throw err
        })
}


function textToSpeech(type, text) {

    return openai.audio.speech.create({
        model: "tts-1",
        voice: type,
        input: text,
    })
        .then(response => {
            return response.arrayBuffer()
        })
        .then((responseArrayBuffer) => {

            const buffer = Buffer.from(responseArrayBuffer)

            return buffer
            // return fs.promises.writeFile(path.resolve("./speech.mp3"), buffer)
        })
        .catch(err => {

            console.log(err)
        })
}


function toLegacyAlignment(alignment) {
    if (!alignment) return {}
    return {
        characters: alignment.characters ?? [],
        character_start_times_seconds: alignment.characterStartTimesSeconds
            ?? alignment.character_start_times_seconds ?? [],
        character_end_times_seconds: alignment.characterEndTimesSeconds
            ?? alignment.character_end_times_seconds ?? [],
    }
}

// outputFormat omitted = ElevenLabs default MP3 (story voice relies on it)
async function elTextToSpeech(voiceId, text, { outputFormat } = {}) {

    return await elevenlabs.textToSpeech.convertWithTimestamps(voiceId, {
        text: text,
        modelId: ELEVENLABS_TTS_MODEL,
        ...(outputFormat ? { outputFormat } : {}),
    })
        .then(response => {
            let audioBase64 = response.audioBase64
            let alignment = toLegacyAlignment(response.alignment)
            let normalizedAlignment = toLegacyAlignment(response.normalizedAlignment)

            return {
                audioBase64,
                alignment,
                normalizedAlignment
            }
        })
        .then(({
                   audioBase64,
                   alignment,
                   normalizedAlignment
               }) => {

            const buffer = Buffer.from(audioBase64, 'base64')

            return {
                buffer,
                alignment,
                normalizedAlignment
            }
        })
        .catch(err => {

            console.log(err)
        })
}

// ReadableStream<Uint8Array> of audio, delivered while ElevenLabs is still generating
async function elStreamTextToSpeech(voiceId, text, { outputFormat } = {}) {
    return await elevenlabs.textToSpeech.stream(voiceId, {
        text: text,
        modelId: ELEVENLABS_TTS_MODEL,
        ...(outputFormat ? { outputFormat } : {}),
    })
}

function toLegacyVoice(voice) {
    if (!voice) return voice
    return {
        ...voice,
        voice_id: voice.voiceId ?? voice.voice_id,
        preview_url: voice.previewUrl ?? voice.preview_url,
    }
}

async function elGetVoices(collectionId) {

    return await elevenlabs.voices.search({
        collectionId,
        sortDirection: 'asc',
        pageSize: 20,
    })
        .then(response => {
            let voices = (response.voices || []).map(toLegacyVoice)
            let hasMore = response.hasMore
            let totalCount = response.totalCount
            let nextPageToken = response.nextPageToken

            return {
                voices,
                hasMore,
                totalCount,
                nextPageToken
            }
        })
        .catch(err => {

            console.log(err)
        })
}

export default {
    query3_5: query3_5,
    textToSpeech: textToSpeech,
    elTextToSpeech: elTextToSpeech,
    elStreamTextToSpeech: elStreamTextToSpeech,
    elGetVoices: elGetVoices,
    generateAgentStep: generateAgentStep,
    generateJson: generateJson,
    embedText: embedText,
    embedTexts: embedTexts,
    embedPdfDocument: embedPdfDocument,
    PDF_MAX_NATIVE_PAGES,
}
