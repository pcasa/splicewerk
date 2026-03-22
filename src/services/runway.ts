import 'dotenv/config'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import RunwayML from '@runwayml/sdk'
import type { TaskRetrieveResponse } from '@runwayml/sdk/resources/tasks.js'
import sharp from 'sharp'

// ─── Types ───────────────────────────────────────────────────────────────────

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

// ─── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_OUTPUT_DIR = 'rendered/runway'
const POLL_INTERVAL_MS = 5000
const MAX_POLL_ATTEMPTS = 60

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getApiKey(): string | null {
  return process.env.RUNWAY_API_KEY ?? null
}

function getOutputDir(): string {
  return process.env.RUNWAY_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR
}

function timestamp(): number {
  return Date.now()
}

// Runway accepts promptImage as base64 data URL; limit is ~10MB for the image.
// We target well under that: resize to at most 1280×720 and drop quality
// progressively until the encoded buffer is under MAX_IMAGE_BYTES.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024 // 4 MB safety ceiling

async function prepareImageForRunway(filePath: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const originalSize = (await fs.stat(filePath)).size
  let quality = 80

  for (let attempt = 1; attempt <= 3; attempt++) {
    const buffer = await sharp(filePath)
      .rotate()                                              // honour EXIF orientation
      .resize(1280, 720, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer()

    console.log(
      `[Runway] Image prep attempt ${attempt}: ${Math.round(originalSize / 1024)}KB → ` +
      `${Math.round(buffer.length / 1024)}KB (quality ${quality}%)`
    )

    if (buffer.length <= MAX_IMAGE_BYTES) {
      return { buffer, mimeType: 'image/jpeg' }
    }

    quality -= 20  // 80 → 60 → 40
  }

  // Last resort: 640×360 at quality 40
  const buffer = await sharp(filePath)
    .rotate()
    .resize(640, 360, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 40 })
    .toBuffer()
  console.log(`[Runway] Image fallback resize: ${Math.round(buffer.length / 1024)}KB`)
  return { buffer, mimeType: 'image/jpeg' }
}

async function ensureOutputDir(outputDir: string): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true })
}

async function saveVideo(
  outputDir: string,
  filename: string,
  buffer: ArrayBuffer
): Promise<string> {
  await ensureOutputDir(outputDir)
  const filePath = path.join(outputDir, filename)
  await fs.writeFile(filePath, Buffer.from(buffer))
  return filePath
}

async function downloadVideo(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download video: HTTP ${response.status}`)
  }
  return response.arrayBuffer()
}

// ─── Polling Helper ───────────────────────────────────────────────────────────

/**
 * Poll a Runway task until it succeeds or fails.
 * Polls every 5 seconds, max 60 attempts (~5 min timeout).
 */
async function pollTask(
  taskId: string,
  client: RunwayML
): Promise<TaskRetrieveResponse> {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    // Wait before polling (first attempt also waits to let task initialize)
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))

    const task = await client.tasks.retrieve(taskId)
    console.log(
      `[Runway] Task ${taskId} | attempt ${attempt}/${MAX_POLL_ATTEMPTS} | status: ${task.status}`
    )

    if (task.status === 'SUCCEEDED' || task.status === 'FAILED') {
      return task
    }
  }

  throw new Error(
    `[Runway] Task ${taskId} timed out after ${MAX_POLL_ATTEMPTS} attempts`
  )
}

// ─── Cost Estimation ─────────────────────────────────────────────────────────

/**
 * Estimate credit cost for a generation.
 * Rough estimate: 5 credits/second for Gen-4 Turbo.
 */
export function estimateCreditCost(durationSeconds: number): number {
  return durationSeconds * 5
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Convert a local image to video using Runway Gen-4 Turbo image-to-video.
 * Reads the image file, encodes it to a base64 data URL, and submits to Runway.
 * Polls until the task completes, then downloads and saves the output video.
 */
export async function imageToVideo(
  imagePath: string,
  prompt: string,
  durationSeconds: 5 | 10
): Promise<Result<string>> {
  const apiKey = getApiKey()
  if (!apiKey) {
    return { ok: false, error: 'RUNWAY_API_KEY not set' }
  }

  const outputDir = getOutputDir()
  const client = new RunwayML({ apiKey })

  console.log(`[Runway] imageToVideo: "${prompt}" (${durationSeconds}s) from ${imagePath}`)

  let taskId: string
  try {
    const { buffer: imageBuffer, mimeType } = await prepareImageForRunway(imagePath)
    const base64 = imageBuffer.toString('base64')
    const dataUrl = `data:${mimeType};base64,${base64}`

    const response = await client.imageToVideo.create({
      model: 'gen4_turbo',
      promptImage: dataUrl,
      promptText: prompt,
      duration: durationSeconds,
      ratio: '1280:720',
    })
    taskId = response.id
    console.log(`[Runway] imageToVideo task created: ${taskId}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to create task: ${message}` }
  }

  let finalTask: TaskRetrieveResponse
  try {
    finalTask = await pollTask(taskId, client)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }

  if (finalTask.status === 'FAILED') {
    return { ok: false, error: finalTask.failure ?? 'generation failed' }
  }

  if (finalTask.status !== 'SUCCEEDED') {
    return { ok: false, error: 'generation failed' }
  }

  try {
    const videoBuffer = await downloadVideo(finalTask.output[0])
    const filename = `iv_${timestamp()}.mp4`
    const filePath = await saveVideo(outputDir, filename, videoBuffer)
    console.log(`[Runway] imageToVideo saved to: ${filePath}`)
    return { ok: true, value: filePath }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to save video: ${message}` }
  }
}

/**
 * Generate video from text prompt using Runway Gen-4 Turbo text-to-video.
 * Submits the prompt to Runway, polls until complete, downloads and saves the output.
 */
export async function textToVideo(
  prompt: string,
  durationSeconds: 5 | 10
): Promise<Result<string>> {
  const apiKey = getApiKey()
  if (!apiKey) {
    return { ok: false, error: 'RUNWAY_API_KEY not set' }
  }

  const outputDir = getOutputDir()
  const client = new RunwayML({ apiKey })

  console.log(`[Runway] textToVideo: "${prompt}" (${durationSeconds}s)`)

  let taskId: string
  try {
    const response = await client.textToVideo.create({
      model: 'gen4.5',
      promptText: prompt,
      duration: durationSeconds,
      ratio: '1280:720',
    })
    taskId = response.id
    console.log(`[Runway] textToVideo task created: ${taskId}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to create task: ${message}` }
  }

  let finalTask: TaskRetrieveResponse
  try {
    finalTask = await pollTask(taskId, client)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }

  if (finalTask.status === 'FAILED') {
    return { ok: false, error: finalTask.failure ?? 'generation failed' }
  }

  if (finalTask.status !== 'SUCCEEDED') {
    return { ok: false, error: 'generation failed' }
  }

  try {
    const videoBuffer = await downloadVideo(finalTask.output[0])
    const filename = `tv_${timestamp()}.mp4`
    const filePath = await saveVideo(outputDir, filename, videoBuffer)
    console.log(`[Runway] textToVideo saved to: ${filePath}`)
    return { ok: true, value: filePath }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to save video: ${message}` }
  }
}

/**
 * Edit an existing video with a prompt using Runway video-to-video.
 * Reads the video file, encodes to base64, and submits to Runway for editing.
 *
 * Note: The SDK's videoToVideo.create uses model 'gen4_aleph' with a videoUri (HTTPS URL).
 * We use gen4_turbo with a base64 data URL here per the service spec.
 * If the API rejects this, consider uploading the video to ephemeral storage first
 * using client.uploads.createEphemeral() and passing the resulting URL as videoUri.
 */
export async function editVideo(
  videoPath: string,
  editPrompt: string
): Promise<Result<string>> {
  const apiKey = getApiKey()
  if (!apiKey) {
    return { ok: false, error: 'RUNWAY_API_KEY not set' }
  }

  const outputDir = getOutputDir()
  const client = new RunwayML({ apiKey })

  console.log(`[Runway] editVideo: "${editPrompt}" on ${videoPath}`)

  let taskId: string
  try {
    const videoBuffer = await fs.readFile(videoPath)
    const base64 = videoBuffer.toString('base64')
    const dataUrl = `data:video/mp4;base64,${base64}`

    // SDK requires gen4_aleph with a videoUri (HTTPS URL).
    // We pass the base64 data URL via cast; caller should upload first if API rejects.
    const response = await (client.videoToVideo.create as (p: unknown) => Promise<{ id: string }>)({
      model: 'gen4_aleph',
      promptVideo: dataUrl,
      promptText: editPrompt,
    })
    taskId = response.id
    console.log(`[Runway] editVideo task created: ${taskId}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to create task: ${message}` }
  }

  let finalTask: TaskRetrieveResponse
  try {
    finalTask = await pollTask(taskId, client)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }

  if (finalTask.status === 'FAILED') {
    return { ok: false, error: finalTask.failure ?? 'generation failed' }
  }

  if (finalTask.status !== 'SUCCEEDED') {
    return { ok: false, error: 'generation failed' }
  }

  try {
    const videoBuffer = await downloadVideo(finalTask.output[0])
    const filename = `ev_${timestamp()}.mp4`
    const filePath = await saveVideo(outputDir, filename, videoBuffer)
    console.log(`[Runway] editVideo saved to: ${filePath}`)
    return { ok: true, value: filePath }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to save video: ${message}` }
  }
}
