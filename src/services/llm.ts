import 'dotenv/config'
import type { EDL, AssetManifest } from '../edl/types.js'

// ─── Types ───

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export type VideoValidation = {
  verdict: 'pass' | 'needs-work'
  summary: string
  issues: string[]
  promptFix?: string
  runwayPromptFix?: string
}

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

// Vision model: Llama 4 Maverick (MoE 17B/128E) — multi-image, 1M context, best VLM on NIM
// Text model: Nemotron 3 Nano — lightweight, fast, text-only
const NEMOTRON_VISION_MODEL = 'meta/llama-4-maverick-17b-128e-instruct'
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
  channelConfig?: ChannelConfig
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
1. Every timeline segment MUST have a "processor" field. Use exactly:
   - "ffmpeg" for video clips, video trimming, stabilization, or color grading
   - "runway" for images (image-to-video), text title cards, or AI-generated scenes
   - "elevenlabs" for audio/SFX generation only
Do not use variations (e.g., "FFmpeg", "runway-gen", "Runway").
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
    return { ok: false, error: `LLM call failed: ${result.error}` }
  }

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

  const systemPrompt = `You are a creative director specializing in cinematic brand video production for high-performance automotive brands.
Write a Runway Gen-4 image-to-video prompt for a logo reveal on a pure black background.
The prompt must describe: cinematic effects (high-speed sparks, metallic sheen, dramatic lighting, embers, fog), color palette inspired by the logo, dynamic camera movement (fast rotations, sweeping motions), and a high-octane overall feel.
Style references: high-performance car commercials, Fast & Furious montages.
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
Mood: ${brand.mood ?? 'high-energy, performance-driven, cinematic'}
Write a Runway Gen-4 prompt that animates this logo on a pure black background with spectacular cinematic effects matching the brand's high-performance identity.
Incorporate elements like speed, power, and precision. Style references: high-performance car commercials, Fast & Furious montages.`,
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

// ─── Prompt Logging ───

/** Stub: will write to Supabase prompt_logs table in Phase 5. */
export async function logPrompt(entry: {
  source: string
  model: string
  messages_in?: unknown
  response_out?: string
  run_id?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  console.log(`[logPrompt] source=${entry.source} model=${entry.model} run_id=${entry.run_id ?? 'n/a'}`)
}

// ─── Video Validation ───

/**
 * Uses the NIM vision model to validate that generated video frames match the
 * original user description. Returns structured feedback as VideoValidation.
 *
 * Accepts up to 5 frame paths; if more are given, evenly samples 5 frames
 * at 0%, 25%, 50%, 75%, and 100% of the array.
 */
export async function validateVideoOutput(
  framePaths: string[],
  userPrompt: string,
  runId?: string
): Promise<Result<VideoValidation>> {
  const nimAuth = NVIDIA_API_KEY ? `Bearer ${NVIDIA_API_KEY}` : undefined

  // ── Sample up to 5 frames evenly ──────────────────────────────────────────
  let selectedPaths: string[]
  if (framePaths.length <= 5) {
    selectedPaths = framePaths
  } else {
    const last = framePaths.length - 1
    selectedPaths = [0, 0.25, 0.5, 0.75, 1].map((pct) => {
      const idx = Math.round(pct * last)
      return framePaths[idx]
    })
  }

  // ── Read frames as base64 ─────────────────────────────────────────────────
  let imageDataUrls: string[]
  try {
    const fs = await import('node:fs/promises')
    imageDataUrls = await Promise.all(
      selectedPaths.map(async (p) => {
        const buf = await fs.readFile(p)
        return `data:image/jpeg;base64,${buf.toString('base64')}`
      })
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to read frame files: ${msg}` }
  }

  // ── Build multimodal message ──────────────────────────────────────────────
  const systemPrompt = `You are a video production expert analyzing the consistency between a generated video and its original description.
Given frames from the final video and the user's original description, provide structured feedback in JSON format.
Output MUST be valid JSON matching exactly this type:
{"verdict":"pass"|"needs-work","summary":"string","issues":["string"],"promptFix":"string (optional)","runwayPromptFix":"string (optional)"}
Be objective. Focus on visual elements, composition, pacing, and how well the video matches the description.
Output ONLY the JSON object. No markdown fences, no explanation.`

  const imageBlocks = imageDataUrls.map((url) => ({
    type: 'image_url' as const,
    image_url: { url },
  }))

  const visionMessages = [
    { role: 'system' as const, content: systemPrompt },
    {
      role: 'user' as const,
      content: [
        ...imageBlocks,
        {
          type: 'text' as const,
          text: `Original description: ${userPrompt}\nAnalyze how well these video frames match the description. Return structured JSON feedback.`,
        },
      ] as unknown as string,
    },
  ]

  // ── Call vision model ─────────────────────────────────────────────────────
  const result = await callLLM(
    visionMessages,
    { model: NEMOTRON_VISION_MODEL, temperature: 0.3, maxTokens: 1024 },
    NIM_BASE_URL,
    nimAuth
  )

  if (!result.ok) {
    return { ok: false, error: `LLM call failed: ${result.error}` }
  }

  // ── Parse JSON response ───────────────────────────────────────────────────
  let raw = result.value.trim()
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await logPrompt({
      source: 'video-validation',
      model: NEMOTRON_VISION_MODEL,
      response_out: result.value,
      run_id: runId,
    })
    return { ok: false, error: `Failed to parse validation response as JSON: ${msg}` }
  }

  // ── Validate required fields ──────────────────────────────────────────────
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('verdict' in parsed) ||
    !('summary' in parsed)
  ) {
    return { ok: false, error: 'Validation response missing required fields: verdict, summary' }
  }

  const validation = parsed as VideoValidation

  // ── Log to prompt_logs ────────────────────────────────────────────────────
  await logPrompt({
    source: 'video-validation',
    model: NEMOTRON_VISION_MODEL,
    response_out: result.value,
    run_id: runId,
  })

  return { ok: true, value: validation }
}

// ─── Helpers ───

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
