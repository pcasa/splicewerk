import 'dotenv/config'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

// ─── Types ───────────────────────────────────────────────────────────────────

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

interface ElevenLabsConfig {
  apiKey: string
  baseUrl: string
  outputDir: string
}

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = 'https://api.elevenlabs.io'
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM' // Rachel

function getConfig(): Result<ElevenLabsConfig> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    return { ok: false, error: 'ELEVENLABS_API_KEY not set' }
  }
  return {
    ok: true,
    value: {
      apiKey,
      baseUrl: BASE_URL,
      outputDir: process.env.ELEVENLABS_OUTPUT_DIR ?? './rendered/audio',
    },
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function ensureOutputDir(outputDir: string): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true })
}

function timestamp(): number {
  return Date.now()
}

async function saveAudio(
  outputDir: string,
  filename: string,
  buffer: ArrayBuffer
): Promise<string> {
  await ensureOutputDir(outputDir)
  const filePath = path.join(outputDir, filename)
  await fs.writeFile(filePath, Buffer.from(buffer))
  return filePath
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a sound effect from a text prompt using the ElevenLabs Sound Generation API.
 * Returns a Result containing the local file path of the downloaded audio.
 */
export async function generateSFX(
  prompt: string,
  durationSeconds: number
): Promise<Result<string>> {
  const configResult = getConfig()
  if (!configResult.ok) return configResult

  const { apiKey, baseUrl, outputDir } = configResult.value

  console.log(`[ElevenLabs] Generating SFX: "${prompt}" (${durationSeconds}s)`)

  let response: Response
  try {
    response = await fetch(`${baseUrl}/v1/sound-generation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text: prompt,
        duration_seconds: durationSeconds,
        prompt_influence: 0.3,
      }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Network error: ${message}` }
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `ElevenLabs API error: HTTP ${response.status}`,
    }
  }

  const buffer = await response.arrayBuffer()
  const filename = `sfx_${timestamp()}.mp3`
  const filePath = await saveAudio(outputDir, filename, buffer)

  console.log(`[ElevenLabs] SFX saved to: ${filePath}`)
  return { ok: true, value: filePath }
}

/**
 * Generate music from a text prompt.
 * Uses the sound-generation endpoint as a stand-in for music generation.
 * Returns a Result containing the local file path of the downloaded audio.
 */
export async function generateMusic(
  prompt: string,
  durationSeconds: number
): Promise<Result<string>> {
  const configResult = getConfig()
  if (!configResult.ok) return configResult

  const { apiKey, baseUrl, outputDir } = configResult.value

  console.log(`[ElevenLabs] Generating music: "${prompt}" (${durationSeconds}s)`)

  let response: Response
  try {
    response = await fetch(`${baseUrl}/v1/sound-generation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text: prompt,
        duration_seconds: durationSeconds,
        prompt_influence: 0.3,
      }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Network error: ${message}` }
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `ElevenLabs API error: HTTP ${response.status}`,
    }
  }

  const buffer = await response.arrayBuffer()
  const filename = `music_${timestamp()}.mp3`
  const filePath = await saveAudio(outputDir, filename, buffer)

  console.log(`[ElevenLabs] Music saved to: ${filePath}`)
  return { ok: true, value: filePath }
}

/**
 * Generate text-to-speech audio using the ElevenLabs TTS API.
 * Returns a Result containing the local file path of the downloaded audio.
 */
export async function generateTTS(
  text: string,
  voiceId?: string
): Promise<Result<string>> {
  const configResult = getConfig()
  if (!configResult.ok) return configResult

  const { apiKey, baseUrl, outputDir } = configResult.value
  const resolvedVoiceId = voiceId ?? DEFAULT_VOICE_ID

  console.log(
    `[ElevenLabs] Generating TTS (voice: ${resolvedVoiceId}): "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`
  )

  let response: Response
  try {
    response = await fetch(`${baseUrl}/v1/text-to-speech/${resolvedVoiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5,
        },
      }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Network error: ${message}` }
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `ElevenLabs API error: HTTP ${response.status}`,
    }
  }

  const buffer = await response.arrayBuffer()
  const filename = `tts_${timestamp()}.mp3`
  const filePath = await saveAudio(outputDir, filename, buffer)

  console.log(`[ElevenLabs] TTS saved to: ${filePath}`)
  return { ok: true, value: filePath }
}
