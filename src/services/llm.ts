import 'dotenv/config'
import type { EDL, AssetManifest } from '../edl/types.js'
import { logPrompt } from '@splicewerk/db'

// ─── Types ───

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface LLMOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  retries?: number
}

export interface ChannelConfig {
  name?: string
  colors?: { primary: string; secondary: string; accent: string }
  fonts?: { heading: string; body: string }
  defaultDurationSeconds?: number
}

// ─── Constants ───

// Primary: NVIDIA NIM hosted endpoint (requires NVIDIA_API_KEY)
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY ?? ''
const NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1'
const DEFAULT_MODEL = process.env.LLM_MODEL ?? 'meta/llama-3.3-70b-instruct'

// Nemotron models on NIM — used for the AI-to-AI pipeline (Nemotron → Runway)
// nemotron-nano-12b-v2-vl: vision-language, can analyze logo images directly
// nemotron-3-nano-30b-a3b: text-only but lightweight and fast
const NEMOTRON_VISION_MODEL = 'nvidia/nemotron-nano-12b-v2-vl'
const NEMOTRON_TEXT_MODEL   = 'nvidia/nemotron-3-nano-30b-a3b'

// Fallback: local Ollama (no auth required)
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434'
const OLLAMA_BASE_URL = `${OLLAMA_HOST}/v1`
const FALLBACK_MODEL = process.env.OLLAMA_FALLBACK_MODEL ?? 'nemotron-3-nano:4b'
const RETRY_DELAYS_MS = [500, 1000, 2000]
const LLM_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

// ─── EDL Schema Description ───

const EDL_SCHEMA_DESCRIPTION = `
EDL (Edit Decision List) JSON Schema:
{
  "project": {
    "title": "string - video title",
    "targetDurationSeconds": "number - target total duration in seconds",
    "aspectRatio": "string - e.g. '16:9', '9:16', '1:1'",
    "resolution": "string - e.g. '1920x1080', '1080x1920'",
    "outputFormats": "string[] - e.g. ['youtube', 'instagram-reels', 'tiktok']"
  },
  "missingAssets": [
    {
      "description": "string - what asset is missing",
      "purpose": "string - why it's needed",
      "priority": "'required' | 'nice-to-have'"
    }
  ],
  "timeline": [
    {
      "id": "string - unique segment identifier",
      "type": "'intro' | 'outro' | 'title_card' | 'before_after' | 'montage' | 'clip' | 'transition' | 'generated'",
      "processor": "'ffmpeg' | 'runway' | 'elevenlabs'",
      "source": "string (optional) - single source file path",
      "sources": "[{ source: string, trim?: string }] (optional) - multiple sources",
      "operation": "string (optional) - ffmpeg operation",
      "prompt": "string (optional) - AI generation prompt",
      "durationSeconds": "number (optional)",
      "trim": "string (optional) - e.g. '0:00-0:05'",
      "transition": "string (optional) - e.g. 'fade'",
      "textOverlay": {
        "text": "string",
        "position": "string",
        "style": "string",
        "leftLabel": "string (optional)",
        "rightLabel": "string (optional)"
      },
      "cropHints": [
        {
          "format": "string - e.g. 'instagram-reels'",
          "focusPoint": "'center' | 'left' | 'right' | 'subject'",
          "offsetX": "number (optional)",
          "offsetY": "number (optional)"
        }
      ]
    }
  ],
  "audio": {
    "backgroundMusic": {
      "source": "string",
      "volume": "number 0-1",
      "fadeIn": "number seconds",
      "fadeOut": "number seconds"
    },
    "sfx": [
      {
        "source": "string",
        "prompt": "string (optional)",
        "timestamp": "number seconds",
        "volume": "number 0-1"
      }
    ],
    "originalAudio": {
      "segments": "string[]",
      "volume": "number 0-1"
    }
  },
  "thumbnail": {
    "type": "string - e.g. 'single', 'before_after'",
    "style": "string - e.g. 'default', 'dramatic'",
    "text": "string (optional)",
    "leftFrame": { "source": "string", "timestamp": "string" },
    "rightFrame": { "source": "string", "timestamp": "string" },
    "frame": { "source": "string", "timestamp": "string" }
  }
}
`

// ─── Core LLM Call ───

export async function callLLM(
  messages: ChatMessage[],
  options: LLMOptions = {},
  baseUrl = NIM_BASE_URL,
  authHeader?: string
): Promise<Result<string>> {
  const {
    model = DEFAULT_MODEL,
    temperature = 0.7,
    maxTokens = 4096,
    retries = 3,
  } = options

  const maxAttempts = retries
  let lastError = ''

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[LLM] Calling model=${model} attempt=${attempt}/${maxAttempts}`)

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)

      let response: Response
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authHeader ? { 'Authorization': authHeader } : {}),
          },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            temperature,
            max_tokens: maxTokens,
          }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeoutId)
      }

      if (!response.ok) {
        const status = response.status
        lastError = `HTTP ${status}: ${response.statusText}`
        console.warn(`[LLM] Request failed: ${lastError} (attempt ${attempt})`)

        // For 503 or connection errors, retry with backoff
        if (attempt < maxAttempts) {
          const delay = RETRY_DELAYS_MS[attempt - 1] ?? 2000
          console.log(`[LLM] Retrying in ${delay}ms...`)
          await sleep(delay)
          continue
        }

        return { ok: false, error: lastError }
      }

      const data = (await response.json()) as {
        choices: { message: { content: string } }[]
      }

      const content = data.choices?.[0]?.message?.content
      if (content == null) {
        return { ok: false, error: 'No content in LLM response' }
      }

      console.log(`[LLM] Success on attempt ${attempt}`)
      return { ok: true, value: content }
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err)
      console.warn(`[LLM] Fetch error: ${lastError} (attempt ${attempt})`)

      if (attempt < maxAttempts) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? 2000
        console.log(`[LLM] Retrying in ${delay}ms...`)
        await sleep(delay)
      }
    }
  }

  return { ok: false, error: `All ${maxAttempts} attempts failed. Last error: ${lastError}` }
}

// ─── EDL Generation ───

export async function generateEDL(
  prompt: string,
  assetManifest: AssetManifest,
  channelConfig?: ChannelConfig,
  runId?: string
): Promise<Result<EDL>> {
  // Build asset list for system prompt
  const assetList = assetManifest.files
    .map((f) => {
      const parts = [`- ${f.filename} (${f.type})`]
      if (f.duration != null) parts[0] += `, duration: ${f.duration}s`
      if (f.width != null && f.height != null) parts[0] += `, ${f.width}x${f.height}`
      return parts[0]
    })
    .join('\n')

  // Build channel branding section
  let brandingSection = ''
  if (channelConfig) {
    brandingSection = `
Channel Branding:
- Name: ${channelConfig.name ?? 'Unknown'}
- Primary color: ${channelConfig.colors?.primary ?? 'N/A'}
- Secondary color: ${channelConfig.colors?.secondary ?? 'N/A'}
- Accent color: ${channelConfig.colors?.accent ?? 'N/A'}
- Heading font: ${channelConfig.fonts?.heading ?? 'N/A'}
- Body font: ${channelConfig.fonts?.body ?? 'N/A'}
- Default duration: ${channelConfig.defaultDurationSeconds ?? 'N/A'}s
`
  }

  const systemPrompt = `You are a professional video editor AI that generates Edit Decision Lists (EDLs) in JSON format.

${EDL_SCHEMA_DESCRIPTION}

Available Assets:
${assetList}
${brandingSection}
CRITICAL RULES:
1. Every timeline segment MUST have a "processor" field. Use:
   - "ffmpeg" for video clips, video trimming, stabilization, or color grading
   - "runway" for images (image-to-video), text title cards, or AI-generated scenes
   - "elevenlabs" for audio/SFX generation only
2. Use EXACT filenames from the Available Assets list above. Do NOT invent or guess filenames.
3. For Runway image segments, "durationSeconds" must be 5 or 10 (round to nearest).
4. For ffmpeg video segments with "operation": "stabilize", include "processor": "ffmpeg".
5. Output ONLY valid JSON. No markdown fences, no explanations. Must be parseable by JSON.parse() directly.`

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ]

  // Try primary model via NVIDIA NIM
  console.log(`[LLM] Generating EDL with model=${DEFAULT_MODEL}`)
  const nimAuth = NVIDIA_API_KEY ? `Bearer ${NVIDIA_API_KEY}` : undefined
  let result = await callLLM(messages, { model: DEFAULT_MODEL }, NIM_BASE_URL, nimAuth)

  // Fallback to local Ollama if NIM fails
  if (!result.ok) {
    console.warn(`[LLM] NIM model failed, falling back to local Ollama: ${FALLBACK_MODEL}`)
    result = await callLLM(messages, { model: FALLBACK_MODEL }, OLLAMA_BASE_URL)
  }

  if (!result.ok) {
    void logPrompt({ source: 'generate-edl', model: DEFAULT_MODEL, messages_in: messages, metadata: { assetCount: assetManifest.files.length }, run_id: runId })
      .catch(() => {})
    return { ok: false, error: `LLM call failed: ${result.error}` }
  }

  void logPrompt({ source: 'generate-edl', model: DEFAULT_MODEL, messages_in: messages, response_out: result.value, metadata: { assetCount: assetManifest.files.length }, run_id: runId })
    .catch(() => {})

  // Strip markdown fences if present
  let raw = result.value.trim()
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  // Parse and validate
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to parse LLM response as JSON: ${msg}` }
  }

  // Validate required fields
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('project' in parsed) ||
    !('timeline' in parsed) ||
    !('audio' in parsed) ||
    !('thumbnail' in parsed)
  ) {
    return {
      ok: false,
      error: 'LLM response missing required EDL fields: project, timeline, audio, thumbnail',
    }
  }

  return { ok: true, value: parsed as EDL }
}

// ─── Cinematic Prompt Generation ───

export interface BrandContext {
  brandName: string
  tagline?: string
  industry?: string
  colors?: { primary?: string; secondary?: string; accent?: string }
  mood?: string
}

/**
 * Use Nemotron (via NIM) to generate a Runway Gen-4 cinematic prompt for a brand logo reveal.
 *
 * If logoImagePath is provided, uses nemotron-nano-12b-v2-vl (vision-language) to analyze
 * the actual logo image and derive brand identity automatically — no hardcoded config needed.
 *
 * This is the core AI-to-AI POC: Nemotron generates the creative brief → Runway executes it.
 *
 * Falls back to text-only Nemotron, then Ollama.
 */
export async function generateCinematicPrompt(
  brand: BrandContext,
  logoImagePath?: string
): Promise<Result<string>> {
  const nimAuth = NVIDIA_API_KEY ? `Bearer ${NVIDIA_API_KEY}` : undefined

  const systemPrompt = `You are a creative director specializing in cinematic brand video production.
Write a Runway Gen-4 image-to-video prompt for a logo reveal on a pure black background.
The prompt must describe: cinematic effects (light rays, sparks, shimmer, embers, fog), color palette, camera movement, and overall feel.
Static locked-off camera — no zoom, no push-in. Wide shot that holds the full logo in frame.
Keep it under 900 characters. Output ONLY the prompt text — no explanation, no preamble.`

  // ── Vision path: Nemotron VL analyzes the actual logo image ──────────────────
  if (logoImagePath && nimAuth) {
    console.log('[Nemotron] Analyzing logo image with vision model...')
    try {
      const imageBuffer = await import('node:fs/promises').then(fs => fs.readFile(logoImagePath))
      const ext = logoImagePath.endsWith('.png') ? 'png' : 'jpeg'
      const dataUrl = `data:image/${ext};base64,${imageBuffer.toString('base64')}`

      const visionMessages = [
        { role: 'system' as const, content: systemPrompt },
        {
          role: 'user' as const,
          content: [
            {
              type: 'image_url' as const,
              image_url: { url: dataUrl },
            },
            {
              type: 'text' as const,
              text: `This is the logo for ${brand.brandName} (${brand.industry ?? 'performance automotive'}).
Analyze the logo's visual style, colors, and composition, then write a Runway Gen-4 prompt
that animates it with spectacular cinematic effects matching the brand's identity.`,
            },
          ] as unknown as string,
        },
      ]

      const visionResult = await callLLM(
        visionMessages,
        { model: NEMOTRON_VISION_MODEL, temperature: 0.9, maxTokens: 512 },
        NIM_BASE_URL,
        nimAuth
      )
      if (visionResult.ok) {
        console.log('[Nemotron] Vision prompt generated successfully')
        return visionResult
      }
      console.warn(`[Nemotron] Vision model failed: ${visionResult.error} — falling back to text`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[Nemotron] Vision path error: ${msg} — falling back to text`)
    }
  }

  // ── Text path: Nemotron text model with brand context ────────────────────────
  const colorDesc = brand.colors
    ? Object.entries(brand.colors).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ')
    : 'not specified'

  const textMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Brand: ${brand.brandName}
Industry: ${brand.industry ?? 'automotive performance'}
Brand Colors: ${colorDesc}
Tagline: ${brand.tagline ?? 'none'}
Mood: ${brand.mood ?? 'cinematic, dramatic, high-budget'}
Write a Runway Gen-4 prompt that animates this logo on a pure black background with spectacular cinematic effects.`,
    },
  ]

  if (nimAuth) {
    const textResult = await callLLM(
      textMessages,
      { model: NEMOTRON_TEXT_MODEL, temperature: 0.9, maxTokens: 512 },
      NIM_BASE_URL,
      nimAuth
    )
    if (textResult.ok) return textResult
    console.warn(`[Nemotron] Text model failed: ${textResult.error} — falling back to Ollama`)
  }

  return callLLM(textMessages, { model: FALLBACK_MODEL, temperature: 0.9, maxTokens: 512 }, OLLAMA_BASE_URL)
}

// ─── Helpers ───

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
