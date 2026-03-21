import 'dotenv/config'
import type { EDL, AssetManifest } from '../edl/types.js'

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

const DEFAULT_MODEL = 'nemotron-3-super:cloud'
const FALLBACK_MODEL = process.env.OLLAMA_FALLBACK_MODEL ?? 'nemotron-3-nano:4b'
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434'
const BASE_URL = `${OLLAMA_HOST}/v1`
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
  options: LLMOptions = {}
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
        response = await fetch(`${BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
IMPORTANT: Output ONLY valid JSON matching the EDL schema above. Do not include any markdown code fences, explanations, or additional text. The response must be parseable by JSON.parse() directly.`

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ]

  // Try primary (cloud) model first
  console.log(`[LLM] Generating EDL with model=${DEFAULT_MODEL}`)
  let result = await callLLM(messages, { model: DEFAULT_MODEL })

  // Fallback to nano model if cloud model fails
  if (!result.ok) {
    console.warn(`[LLM] Cloud model failed, falling back to ${FALLBACK_MODEL}`)
    result = await callLLM(messages, { model: FALLBACK_MODEL })
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

// ─── Helpers ───

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
