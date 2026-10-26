import aiHelpers from '../aiHelpers.js'
import { avatarIsLive, usesAnamVoice } from './anam.js'

import logger from '../logger.js'

const MAX_TTS_CHARS = 5000
export const AVATAR_PCM_RATE = 16000

function ttsOptions(agent) {
  return avatarIsLive(agent) ? { outputFormat: `pcm_${AVATAR_PCM_RATE}` } : {}
}

// ElevenLabs TTS for agent read-aloud. Returns null when voice off or TTS fails.
// Avatar on: raw PCM s16le 16 kHz mono — the only format Anam passthrough takes.
// Anam voice: null — the browser sends the text to Anam, no ElevenLabs call.
export default async function speakAgentText(agent, text) {
  const spoken = String(text || '').trim().slice(0, MAX_TTS_CHARS)
  if (usesAnamVoice(agent)) return null
  if (!agent.voiceEnabled || !agent.voiceId || !spoken) return null

  const parts = []
  try {
    // Streamed + collected: no timestamp alignment (unused here), so it finishes sooner
    const stream = await aiHelpers.elStreamTextToSpeech(agent.voiceId, spoken, ttsOptions(agent))
    for await (const part of stream) parts.push(part)
  } catch (err) {
    logger.error('agent TTS failed', { eventName: 'AGENT_TTS_FAILED', err: err })
    return null
  }
  const buffer = Buffer.concat(parts)
  if (!buffer.length) return null

  if (avatarIsLive(agent)) {
    return {
      audioBase64: buffer.toString('base64'),
      mimeType: 'audio/pcm',
      encoding: 'pcm_s16le',
      sampleRate: AVATAR_PCM_RATE,
    }
  }

  return {
    audioBase64: buffer.toString('base64'),
    mimeType: 'audio/mpeg',
  }
}

// ~100 ms of audio. Multiple of 6 = whole s16le samples AND whole base64 groups,
// so the browser can join chunks by plain base64 string concat.
const MIN_CHUNK_BYTES = 3204

// Avatar PCM pushed to onChunk as ElevenLabs generates it, so the face starts
// talking right after the text instead of after the whole clip. Every chunk
// but the last has final: false. Returns false when this agent doesn't stream
// (no avatar / Anam voice / voice off) — caller falls back to speakAgentText.
export async function streamAgentPcm(agent, text, onChunk) {
  const spoken = String(text || '').trim().slice(0, MAX_TTS_CHARS)
  if (usesAnamVoice(agent) || !avatarIsLive(agent)) return false
  if (!agent.voiceEnabled || !agent.voiceId || !spoken) return false

  const emit = (buffer, final) => onChunk({
    audioBase64: buffer.toString('base64'),
    mimeType: 'audio/pcm',
    encoding: 'pcm_s16le',
    sampleRate: AVATAR_PCM_RATE,
    final,
  })

  const stream = await aiHelpers.elStreamTextToSpeech(agent.voiceId, spoken, ttsOptions(agent))
  let pending = Buffer.alloc(0)
  // Held back one round so the last emitted chunk is non-empty and carries final: true
  let ready = null
  for await (const part of stream) {
    pending = Buffer.concat([pending, part])
    if (pending.length < MIN_CHUNK_BYTES) continue
    const cut = pending.length - (pending.length % 6)
    if (ready) emit(ready, false)
    ready = pending.subarray(0, cut)
    pending = pending.subarray(cut)
  }
  const last = Buffer.concat([ready || Buffer.alloc(0), pending])
  if (last.length) emit(last, true)
  return true
}
