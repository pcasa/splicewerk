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

// ─── Quota / Pre-flight ──────────────────────────────────────────────────────

export interface SoundEffectQuota {
  creditsRemaining: number   // -1 means unknown (API doesn't expose it directly)
  creditsPerSecond: number   // ~6 for starter plan
  maxAffordableSeconds: number
}

/**
 * Estimate how many sound-effect credits remain by probing the subscription
 * endpoint. ElevenLabs does not expose sound-effect credits directly, so we
 * derive the estimate from the last known rate (6 credits/second).
 *
 * Returns creditsRemaining = -1 when the account tier doesn't expose it.
 */
export async function getSoundEffectQuota(): Promise<Result<SoundEffectQuota>> {
  const configResult = getConfig()
  if (!configResult.ok) return configResult

  const { apiKey, baseUrl } = configResult.value

  try {
    const res = await fetch(`${baseUrl}/v1/user/subscription`, {
      headers: { 'xi-api-key': apiKey },
    })
    if (!res.ok) return { ok: false, error: `Quota check failed: HTTP ${res.status}` }

    const data = await res.json() as Record<string, unknown>

    // ElevenLabs exposes TTS character quota but not sound-effect credits.
    // We expose what we know and flag that the exact count is unknown.
    const tier = String(data.tier ?? 'unknown')
    console.log(`[ElevenLabs] Account tier: ${tier}`)

    return {
      ok: true,
      value: {
        creditsRemaining: -1,   // not exposed via API; only known on error
        creditsPerSecond: 6,    // empirical: ~6 credits/sec for starter plan
        maxAffordableSeconds: -1,
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Quota check network error: ${message}` }
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
    // Parse body to expose quota/auth details (ElevenLabs returns 401 for quota exceeded)
    let detail = response.statusText
    try {
      const body = await response.json() as { detail?: { status?: string; message?: string } | string }
      const d = body.detail
      if (d && typeof d === 'object' && d.message) detail = `${d.status ?? ''}: ${d.message}`
      else if (typeof d === 'string') detail = d
    } catch { /* ignore parse errors */ }
    return { ok: false, error: `ElevenLabs HTTP ${response.status} — ${detail}` }
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
