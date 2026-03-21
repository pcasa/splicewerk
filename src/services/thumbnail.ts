import 'dotenv/config'
import sharp from 'sharp'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)

// ─── Result Type ───

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

// ─── Options ───

export interface ThumbnailOptions {
  text?: string
  outputPath?: string
  textColor?: string
  fontSize?: number
  dividerColor?: string
  dividerWidth?: number
}

// ─── Helpers ───

function getOutputDir(): string {
  return process.env.THUMBNAIL_OUTPUT_DIR ?? './rendered/thumbnails'
}

async function ensureOutputDir(outputPath: string): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
}

function defaultOutputPath(): string {
  const outputDir = getOutputDir()
  return path.join(outputDir, `${Date.now()}.jpg`)
}

function makeTextSvg(text: string, width: number, height: number, options: ThumbnailOptions): Buffer {
  const fontSize = options.fontSize ?? 72
  const color = options.textColor ?? 'white'
  const svg = `<svg width="${width}" height="${height}">
    <style>.t { font: bold ${fontSize}px sans-serif; fill: ${color}; }</style>
    <text x="50%" y="15%" text-anchor="middle" class="t">${text}</text>
  </svg>`
  return Buffer.from(svg)
}

// ─── Functions ───

/**
 * Extract a single frame from a video at the given timestamp using FFmpeg.
 * Returns the path to the extracted frame image.
 */
export async function extractFrame(
  videoPath: string,
  timestampSeconds: number,
  outputPath?: string
): Promise<Result<string>> {
  const resolvedOutput = outputPath ?? path.join(tmpdir(), `${randomUUID()}.jpg`)

  const args = [
    '-ss', String(timestampSeconds),
    '-i', videoPath,
    '-frames:v', '1',
    '-q:v', '2',
    resolvedOutput,
  ]

  try {
    await execFileAsync('ffmpeg', args)
    return { ok: true, value: resolvedOutput }
  } catch (err: unknown) {
    const error = err as { message?: string; stderr?: string }
    const message = error.stderr ?? error.message ?? 'Unknown ffmpeg error'
    return { ok: false, error: message }
  }
}

/**
 * Generate a before/after split thumbnail (1280×720).
 * Left image on the left half, right image on the right half,
 * with a vertical divider line in the middle.
 */
export async function beforeAfterSplit(
  leftImagePath: string,
  rightImagePath: string,
  options?: ThumbnailOptions
): Promise<Result<string>> {
  const outputPath = options?.outputPath ?? defaultOutputPath()
  const dividerWidth = options?.dividerWidth ?? 4

  try {
    await ensureOutputDir(outputPath)

    const leftBuffer = await sharp(leftImagePath)
      .resize(640, 720, { fit: 'cover' })
      .toBuffer()

    const rightBuffer = await sharp(rightImagePath)
      .resize(640, 720, { fit: 'cover' })
      .toBuffer()

    const dividerX = Math.floor((1280 - dividerWidth) / 2)
    const dividerBuffer = await sharp({
      create: {
        width: dividerWidth,
        height: 720,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer()

    const composites: sharp.OverlayOptions[] = [
      { input: leftBuffer, left: 0, top: 0 },
      { input: rightBuffer, left: 640, top: 0 },
      { input: dividerBuffer, left: dividerX, top: 0 },
    ]

    if (options?.text) {
      const textSvg = makeTextSvg(options.text, 1280, 720, options)
      composites.push({ input: textSvg, left: 0, top: 0 })
    }

    await sharp({
      create: {
        width: 1280,
        height: 720,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite(composites)
      .jpeg({ quality: 95 })
      .toFile(outputPath)

    return { ok: true, value: outputPath }
  } catch (err: unknown) {
    const error = err as { message?: string }
    return { ok: false, error: error.message ?? 'Unknown error' }
  }
}

/**
 * Generate a single-frame thumbnail (1280×720) with optional text overlay.
 */
export async function singleFrame(
  imagePath: string,
  options?: ThumbnailOptions
): Promise<Result<string>> {
  const outputPath = options?.outputPath ?? defaultOutputPath()

  try {
    await ensureOutputDir(outputPath)

    const composites: sharp.OverlayOptions[] = []

    if (options?.text) {
      const textSvg = makeTextSvg(options.text, 1280, 720, options)
      composites.push({ input: textSvg, left: 0, top: 0 })
    }

    const image = sharp(imagePath).resize(1280, 720, { fit: 'cover' })

    if (composites.length > 0) {
      await image
        .composite(composites)
        .jpeg({ quality: 95 })
        .toFile(outputPath)
    } else {
      await image
        .jpeg({ quality: 95 })
        .toFile(outputPath)
    }

    return { ok: true, value: outputPath }
  } catch (err: unknown) {
    const error = err as { message?: string }
    return { ok: false, error: error.message ?? 'Unknown error' }
  }
}

/**
 * Generate a collage thumbnail from 2–4 images (1280×720).
 * - 2 images: side-by-side 640×720 each
 * - 3 images: top-left 640×360, top-right 640×360, bottom-center 640×360
 * - 4 images: 2×2 grid of 640×360 each
 */
export async function collage(
  imagePaths: string[],
  options?: ThumbnailOptions
): Promise<Result<string>> {
  const outputPath = options?.outputPath ?? defaultOutputPath()
  const images = imagePaths.slice(0, 4)

  if (images.length < 2) {
    return { ok: false, error: 'collage requires at least 2 images' }
  }

  try {
    await ensureOutputDir(outputPath)

    const composites: sharp.OverlayOptions[] = []

    if (images.length === 2) {
      // Side-by-side: 640×720 each
      const buf0 = await sharp(images[0]).resize(640, 720, { fit: 'cover' }).toBuffer()
      const buf1 = await sharp(images[1]).resize(640, 720, { fit: 'cover' }).toBuffer()
      composites.push({ input: buf0, left: 0, top: 0 })
      composites.push({ input: buf1, left: 640, top: 0 })
    } else if (images.length === 3) {
      // Top-left 640×360, top-right 640×360, bottom-center 640×360
      const buf0 = await sharp(images[0]).resize(640, 360, { fit: 'cover' }).toBuffer()
      const buf1 = await sharp(images[1]).resize(640, 360, { fit: 'cover' }).toBuffer()
      const buf2 = await sharp(images[2]).resize(640, 360, { fit: 'cover' }).toBuffer()
      composites.push({ input: buf0, left: 0, top: 0 })
      composites.push({ input: buf1, left: 640, top: 0 })
      composites.push({ input: buf2, left: 320, top: 360 })
    } else {
      // 4 images: 2×2 grid of 640×360 each
      const buf0 = await sharp(images[0]).resize(640, 360, { fit: 'cover' }).toBuffer()
      const buf1 = await sharp(images[1]).resize(640, 360, { fit: 'cover' }).toBuffer()
      const buf2 = await sharp(images[2]).resize(640, 360, { fit: 'cover' }).toBuffer()
      const buf3 = await sharp(images[3]).resize(640, 360, { fit: 'cover' }).toBuffer()
      composites.push({ input: buf0, left: 0, top: 0 })
      composites.push({ input: buf1, left: 640, top: 0 })
      composites.push({ input: buf2, left: 0, top: 360 })
      composites.push({ input: buf3, left: 640, top: 360 })
    }

    if (options?.text) {
      const textSvg = makeTextSvg(options.text, 1280, 720, options)
      composites.push({ input: textSvg, left: 0, top: 0 })
    }

    await sharp({
      create: {
        width: 1280,
        height: 720,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite(composites)
      .jpeg({ quality: 95 })
      .toFile(outputPath)

    return { ok: true, value: outputPath }
  } catch (err: unknown) {
    const error = err as { message?: string }
    return { ok: false, error: error.message ?? 'Unknown error' }
  }
}
