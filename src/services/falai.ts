import 'dotenv/config'
import { fal } from '@fal-ai/client'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

// ─── Types ───────────────────────────────────────────────────────────────────

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

// ─── Video model catalog ─────────────────────────────────────────────────────
// Cost guide (approximate, per second of output):
//   Kling 3.0 Pro        ~$0.030/s  — best motion physics, film-grade
//   Veo 3.1 Fast         ~$0.050/s  — Google model, native audio, high fidelity
//   WAN 2.5 Preview      ~$0.008/s  — budget T2V / I2V
//   MiniMax Hailuo-02    ~$0.025/s  — strong motion + lip sync, 6s default
//   LTX Video            ~$0.004/s  — fastest generation (~10s), great for drafts
//   Hunyuan Video        ~$0.015/s  — Tencent, excellent motion consistency
//   CogVideoX-5B         ~$0.010/s  — open-weight, good for stylized content

export type FalVideoModel =
  // ── Kling (KlingAI) ──────────────────────────────────────────────
  | 'fal-ai/kling-video/v3/pro/image-to-video'
  | 'fal-ai/kling-video/v3/pro/text-to-video'
  | 'fal-ai/kling-video/v2.1/standard/image-to-video'
  | 'fal-ai/kling-video/v2.1/standard/text-to-video'
  // ── Google Veo ───────────────────────────────────────────────────
  | 'fal-ai/veo3.1-fast/image-to-video'
  | 'fal-ai/veo3.1-fast/text-to-video'
  // ── WAN (Wan Video) ──────────────────────────────────────────────
  | 'fal-ai/wan-25-preview/image-to-video'
  | 'fal-ai/wan-25-preview/text-to-video'
  // ── MiniMax Hailuo-02 ────────────────────────────────────────────
  | 'fal-ai/minimax/video-01'
  | 'fal-ai/minimax/video-01-live'
  // ── LTX Video (fastest) ──────────────────────────────────────────
  | 'fal-ai/ltx-video'
  | 'fal-ai/ltx-video/image-to-video'
  // ── Hunyuan Video (Tencent) ──────────────────────────────────────
  | 'fal-ai/hunyuan-video'
  | 'fal-ai/hunyuan-video/image-to-video'
  // ── CogVideoX ────────────────────────────────────────────────────
  | 'fal-ai/cogvideox-5b'
  | 'fal-ai/cogvideox-5b/image-to-video'

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

// ─── Per-model input normalization ───────────────────────────────────────────

/**
 * Each model family uses slightly different field names and value shapes.
 * This helper maps our canonical inputs to the correct API shape for each model.
 */
function buildVideoInput(
  model: string,
  prompt: string,
  imageUrl: string | undefined,
  duration: number,
  aspectRatio: string
): Record<string, unknown> {
  // MiniMax uses prompt_text + duration as string enum
  if (model.includes('minimax')) {
    const base: Record<string, unknown> = {
      prompt,
      duration: duration <= 6 ? 6 : 9, // MiniMax only supports 6 or 9
      aspect_ratio: aspectRatio,
    }
    if (imageUrl) base.image_url = imageUrl
    return base
  }

  // LTX Video uses image_url at top level, duration in seconds
  if (model.includes('ltx-video')) {
    const base: Record<string, unknown> = {
      prompt,
      duration: duration,
      aspect_ratio: aspectRatio,
    }
    if (imageUrl) base.image_url = imageUrl
    return base
  }

  // Hunyuan uses num_frames or duration, image_url for i2v variant
  if (model.includes('hunyuan')) {
    const base: Record<string, unknown> = {
      prompt,
      duration: duration,
    }
    if (imageUrl) base.image_url = imageUrl
    return base
  }

  // CogVideoX: prompt + image_url (i2v) or just prompt (t2v)
  if (model.includes('cogvideox')) {
    const base: Record<string, unknown> = {
      prompt,
      duration: duration,
      aspect_ratio: aspectRatio,
    }
    if (imageUrl) base.image_url = imageUrl
    return base
  }

  // Default (Kling, Veo, WAN) — standard schema
  const base: Record<string, unknown> = {
    prompt,
    duration,
    aspect_ratio: aspectRatio,
  }
  if (imageUrl) base.image_url = imageUrl
  return base
}

// ─── Image to Video ──────────────────────────────────────────────────────────

/**
 * Animate a static image into video using fal.ai.
 * Defaults to Kling 3.0 Pro (~$0.03/sec).
 */
export async function imageToVideo(opts: ImageToVideoInput): Promise<Result<FalVideoOutput>> {
  const init = initClient()
  if (!init.ok) return init

  const model = opts.model ?? 'fal-ai/kling-video/v3/pro/image-to-video'
  const input = buildVideoInput(model, opts.prompt, opts.image_url, opts.duration ?? 5, opts.aspect_ratio ?? '16:9')

  try {
    const result = await fal.subscribe(model, { input }) as { data: { video: { url: string; width?: number; height?: number } } }

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
  const input = buildVideoInput(model, opts.prompt, undefined, opts.duration ?? 5, opts.aspect_ratio ?? '16:9')

  try {
    const result = await fal.subscribe(model, { input }) as { data: { video: { url: string; width?: number; height?: number } } }

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

// ─── Download Image Helper ────────────────────────────────────────────────────

export async function downloadFalImage(url: string, outputPath: string): Promise<Result<string>> {
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

// ─── Text to Image ────────────────────────────────────────────────────────────

// ─── Image model catalog ─────────────────────────────────────────────────────
// Cost guide (approximate per image at 1920×1080):
//   Flux Dev             ~$0.025  — quality baseline, slow
//   Flux Schnell         ~$0.003  — 4-step distilled, very fast
//   Flux Pro v1.1 Ultra  ~$0.060  — highest quality, up to 4MP
//   Flux Pro             ~$0.040  — pro tier, fast
//   Ideogram v3          ~$0.080  — best text rendering in images
//   Recraft v3           ~$0.040  — best for vector/design/brand assets
//   SDXL Lightning       ~$0.002  — cheapest, good for drafts

export type FalImageModel =
  // ── Flux (Black Forest Labs) ─────────────────────────────────────
  | 'fal-ai/flux/dev'
  | 'fal-ai/flux/schnell'
  | 'fal-ai/flux-pro'
  | 'fal-ai/flux-pro/v1.1'
  | 'fal-ai/flux-pro/v1.1-ultra'
  // ── Ideogram (best text in images) ──────────────────────────────
  | 'fal-ai/ideogram/v2'
  | 'fal-ai/ideogram/v2/turbo'
  // ── Recraft (best for brand/design) ─────────────────────────────
  | 'fal-ai/recraft-v3'
  // ── SDXL (budget) ────────────────────────────────────────────────
  | 'fal-ai/fast-sdxl'
  | 'fal-ai/stable-diffusion-xl-lightning'

export interface TextToImageInput {
  model?: FalImageModel
  prompt: string
  width?: number
  height?: number
  numImages?: number
}

export interface FalImageOutput {
  imageUrl: string
  width?: number
  height?: number
}

function buildImageInput(
  model: string,
  prompt: string,
  width: number,
  height: number,
  numImages: number
): Record<string, unknown> {
  // Ideogram: uses aspect_ratio string instead of width/height; supports style
  if (model.includes('ideogram')) {
    const ratio = width >= height ? '16:9' : '9:16'
    return { prompt, aspect_ratio: ratio, num_images: numImages }
  }

  // Recraft: uses width/height directly at top level
  if (model.includes('recraft')) {
    return { prompt, width, height, n: numImages }
  }

  // SDXL variants: use width/height directly, num_inference_steps
  if (model.includes('sdxl') || model.includes('stable-diffusion')) {
    return { prompt, width, height, num_inference_steps: 4, num_images: numImages }
  }

  // Flux (default): image_size object
  return { prompt, image_size: { width, height }, num_images: numImages }
}

export async function textToImage(opts: TextToImageInput): Promise<Result<FalImageOutput>> {
  const init = initClient()
  if (!init.ok) return init

  const model = opts.model ?? 'fal-ai/flux/dev'
  const input = buildImageInput(model, opts.prompt, opts.width ?? 1920, opts.height ?? 1080, opts.numImages ?? 1)

  try {
    const result = await fal.subscribe(model, { input }) as {
      data: {
        images?: Array<{ url: string; width?: number; height?: number }>
        image?: { url: string; width?: number; height?: number }
      }
    }

    // Different models use 'images' array or single 'image'
    const image = result.data?.images?.[0] ?? result.data?.image
    if (!image?.url) return { ok: false, error: 'No image URL in fal.ai response' }

    return { ok: true, value: { imageUrl: image.url, width: image.width, height: image.height } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
