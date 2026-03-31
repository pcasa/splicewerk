import 'dotenv/config'
import { fal } from '@fal-ai/client'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

// ─── Types ───────────────────────────────────────────────────────────────────

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export type FalVideoModel =
  | 'fal-ai/kling-video/v3/pro/image-to-video'
  | 'fal-ai/kling-video/v3/pro/text-to-video'
  | 'fal-ai/veo3.1-fast/image-to-video'
  | 'fal-ai/veo3.1-fast/text-to-video'
  | 'fal-ai/wan-25-preview/image-to-video'
  | 'fal-ai/wan-25-preview/text-to-video'

export interface ImageToVideoInput {
  model?: FalVideoModel
  prompt: string
  image_url: string
  duration?: 5 | 10
  aspect_ratio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4'
}

export interface TextToVideoInput {
  model?: FalVideoModel
  prompt: string
  duration?: 5 | 10
  aspect_ratio?: '16:9' | '9:16' | '1:1'
}

export interface FalVideoOutput {
  videoUrl: string
  width?: number
  height?: number
}

// ─── Config ──────────────────────────────────────────────────────────────────

function initClient(): Result<void> {
  const key = process.env.FAL_KEY
  if (!key) return { ok: false, error: 'FAL_KEY not set' }
  fal.config({ credentials: key })
  return { ok: true, value: undefined }
}

// ─── Image to Video ──────────────────────────────────────────────────────────

/**
 * Animate a static image into video using fal.ai.
 * Defaults to Kling 3.0 Pro (~$0.03/sec) — cheapest high-quality option.
 */
export async function imageToVideo(opts: ImageToVideoInput): Promise<Result<FalVideoOutput>> {
  const init = initClient()
  if (!init.ok) return init

  const model = opts.model ?? 'fal-ai/kling-video/v3/pro/image-to-video'

  try {
    const result = await fal.subscribe(model, {
      input: {
        prompt: opts.prompt,
        image_url: opts.image_url,
        duration: opts.duration ?? 5,
        aspect_ratio: opts.aspect_ratio ?? '16:9',
      },
    }) as { data: { video: { url: string; width?: number; height?: number } } }

    const video = result.data?.video
    if (!video?.url) return { ok: false, error: 'No video URL in fal.ai response' }

    return { ok: true, value: { videoUrl: video.url, width: video.width, height: video.height } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Text to Video ───────────────────────────────────────────────────────────

/**
 * Generate video from text prompt only.
 * Defaults to Kling 3.0 Pro text-to-video.
 */
export async function textToVideo(opts: TextToVideoInput): Promise<Result<FalVideoOutput>> {
  const init = initClient()
  if (!init.ok) return init

  const model = opts.model ?? 'fal-ai/kling-video/v3/pro/text-to-video'

  try {
    const result = await fal.subscribe(model, {
      input: {
        prompt: opts.prompt,
        duration: opts.duration ?? 5,
        aspect_ratio: opts.aspect_ratio ?? '16:9',
      },
    }) as { data: { video: { url: string; width?: number; height?: number } } }

    const video = result.data?.video
    if (!video?.url) return { ok: false, error: 'No video URL in fal.ai response' }

    return { ok: true, value: { videoUrl: video.url, width: video.width, height: video.height } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Download Helper ─────────────────────────────────────────────────────────

/**
 * Download a video URL returned by fal.ai to a local file path.
 */
export async function downloadFalVideo(url: string, outputPath: string): Promise<Result<string>> {
  try {
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    const response = await fetch(url)
    if (!response.ok) return { ok: false, error: `Download failed: ${response.status} ${response.statusText}` }
    const buffer = await response.arrayBuffer()
    await fs.writeFile(outputPath, Buffer.from(buffer))
    return { ok: true, value: outputPath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
