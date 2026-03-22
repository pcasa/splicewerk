import 'dotenv/config'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

// ─── Types ───────────────────────────────────────────────────────────────────

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

type ShotstackEnv = 'stage' | 'v1'

interface ShotstackClip {
  asset: {
    type: 'video' | 'image' | 'audio' | 'title' | 'html'
    src?: string
    text?: string
    style?: string
    color?: string
    size?: string
    background?: string
    position?: string
  }
  start: number
  length: number
  transition?: {
    in?: string
    out?: string
  }
  effect?: string
  fit?: string
  position?: string
  offset?: { x?: number; y?: number }
}

interface ShotstackTrack {
  clips: ShotstackClip[]
}

interface ShotstackEdit {
  timeline: {
    background?: string
    tracks: ShotstackTrack[]
  }
  output: {
    format: 'mp4' | 'gif' | 'jpg' | 'png' | 'mp3'
    resolution?: 'preview' | 'mobile' | 'sd' | 'hd' | 'fhd' | '1080' | '720'
    aspectRatio?: '16:9' | '9:16' | '1:1' | '4:5' | '4:3'
    fps?: number
    size?: { width: number; height: number }
    quality?: 'low' | 'medium' | 'high'
    destinations?: { provider: string }[]
  }
}

// ─── Config ──────────────────────────────────────────────────────────────────

const SHOTSTACK_ENV: ShotstackEnv = (process.env.SHOTSTACK_ENV ?? 'stage') as ShotstackEnv

// Correct Shotstack API base URLs per official docs:
// Edit API:   https://api.shotstack.io/edit/{stage|v1}
// Ingest API: https://api.shotstack.io/ingest/{stage|v1}
const RENDER_BASE = `https://api.shotstack.io/edit/${SHOTSTACK_ENV}`
const INGEST_BASE = `https://api.shotstack.io/ingest/${SHOTSTACK_ENV}`

const POLL_INTERVAL_MS = 4000
const MAX_RENDER_POLLS = 120  // ~8 minutes
const MAX_INGEST_POLLS = 30   // ~2 minutes

function getApiKey(): string {
  const key = process.env.SHOTSTACK_API_KEY
  if (!key) throw new Error('SHOTSTACK_API_KEY not set')
  return key
}

function headers(): Record<string, string> {
  return {
    'x-api-key': getApiKey(),
    'Content-Type': 'application/json',
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── Ingest: upload a local file → get hosted URL ────────────────────────────

async function getPresignedUpload(): Promise<{ id: string; uploadUrl: string }> {
  const res = await fetch(`${INGEST_BASE}/upload`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Shotstack upload init failed: ${res.status} ${text}`)
  }
  // Response: { data: { id, attributes: { url, expires } } }
  const json = (await res.json()) as { data: { id: string; attributes: { url: string } } }
  return { id: json.data.id, uploadUrl: json.data.attributes.url }
}

async function putFileToS3(uploadUrl: string, filePath: string): Promise<void> {
  const { size } = await fs.stat(filePath)
  console.log(`[Shotstack] Uploading ${Math.round(size / 1024 / 1024)}MB to S3...`)

  // Extract x-amz-* query params as HTTP headers.
  // Shotstack's Signature V2 presigned URL bakes x-amz-acl and x-amz-security-token
  // into the query string — they must also be sent as request headers.
  //
  // IMPORTANT: use decodeURIComponent, NOT URLSearchParams. URLSearchParams follows
  // HTML form encoding and decodes '+' as space, which corrupts AWS tokens that
  // contain literal '+' characters from base64 encoding.
  const amzHeaders: Record<string, string> = {}
  const rawQuery = uploadUrl.split('?')[1] ?? ''
  for (const pair of rawQuery.split('&')) {
    const eqIdx = pair.indexOf('=')
    if (eqIdx === -1) continue
    const key = decodeURIComponent(pair.slice(0, eqIdx))
    const value = decodeURIComponent(pair.slice(eqIdx + 1))
    if (key.startsWith('x-amz-')) {
      amzHeaders[key] = value
    }
  }

  // Do NOT send Content-Type: Shotstack signs the presigned URL without specifying
  // one (they don't know the file type at signing time), so adding Content-Type
  // changes the canonical string and causes 403 SignatureDoesNotMatch.
  const buffer = await fs.readFile(filePath)
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: amzHeaders,
    body: buffer,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`S3 upload failed: ${res.status} ${text}`)
  }
}

async function pollIngestSource(sourceId: string): Promise<string> {
  for (let i = 0; i < MAX_INGEST_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS)
    const res = await fetch(`${INGEST_BASE}/sources/${sourceId}`, {
      headers: { 'x-api-key': getApiKey() },
    })
    if (!res.ok) throw new Error(`Ingest poll failed: ${res.status}`)
    // Response: { data: { attributes: { status, source, ... } } }
    // The hosted URL is in the 'source' field, not 'url'
    const json = (await res.json()) as {
      data: { attributes: { status: string; source: string } }
    }
    const { status, source } = json.data.attributes
    console.log(`[Shotstack] Ingest ${sourceId} | status: ${status}`)
    if (status === 'ready') return source
    if (status === 'failed') throw new Error(`Ingest failed for source ${sourceId}`)
  }
  throw new Error(`Ingest timed out for source ${sourceId}`)
}

/**
 * Upload a local file to Shotstack's CDN and return the hosted URL.
 */
export async function uploadFile(localPath: string): Promise<Result<string>> {
  try {
    console.log(`[Shotstack] Uploading: ${localPath}`)
    const { id, uploadUrl } = await getPresignedUpload()
    await putFileToS3(uploadUrl, localPath)
    const hostedUrl = await pollIngestSource(id)
    console.log(`[Shotstack] Upload ready: ${hostedUrl}`)
    return { ok: true, value: hostedUrl }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

async function submitRender(edit: ShotstackEdit): Promise<string> {
  const res = await fetch(`${RENDER_BASE}/render`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(edit),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Render submit failed: ${res.status} ${text}`)
  }
  // Response: { success: true, message: "Created", response: { id, message } }
  const json = (await res.json()) as { response: { id: string } }
  return json.response.id
}

async function pollRender(renderId: string): Promise<string> {
  for (let i = 0; i < MAX_RENDER_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS)
    const res = await fetch(`${RENDER_BASE}/render/${renderId}`, {
      headers: { 'x-api-key': getApiKey() },
    })
    if (!res.ok) throw new Error(`Render poll failed: ${res.status}`)
    // Response: { success: bool, message: string, response: { id, status, url, ... } }
    const json = (await res.json()) as {
      response: { id: string; status: string; url: string; error?: string }
    }
    const { status, url, error } = json.response
    console.log(`[Shotstack] Render ${renderId} | status: ${status}`)
    if (status === 'done') return url
    if (status === 'failed') throw new Error(`Render failed: ${error ?? 'unknown'}`)
  }
  throw new Error(`Render timed out: ${renderId}`)
}

async function downloadRender(url: string, outputPath: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  const buffer = await res.arrayBuffer()
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, Buffer.from(buffer))
}

/**
 * Submit a Shotstack edit, poll until done, download and return the local output path.
 */
export async function renderEdit(
  edit: ShotstackEdit,
  outputPath: string
): Promise<Result<string>> {
  try {
    console.log(`[Shotstack] Submitting render...`)
    const renderId = await submitRender(edit)
    console.log(`[Shotstack] Render ID: ${renderId}`)
    const outputUrl = await pollRender(renderId)
    await downloadRender(outputUrl, outputPath)
    console.log(`[Shotstack] Render saved to: ${outputPath}`)
    return { ok: true, value: outputPath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── High-level: assemble clips into a final video ───────────────────────────

export interface AssemblySegment {
  url: string         // Shotstack-hosted URL
  durationSeconds: number
  transitionIn?: string
  transitionOut?: string
}

export interface AssemblyOptions {
  width?: number
  height?: number
  fps?: number
  format?: 'mp4'
  backgroundMusic?: { url: string; volume: number; fadeOut?: number }
}

/**
 * Concat a list of hosted video clips into a single output via Shotstack.
 * Optionally mixes in background music.
 */
export async function assembleClips(
  segments: AssemblySegment[],
  outputPath: string,
  options: AssemblyOptions = {}
): Promise<Result<string>> {
  const { width = 1920, height = 1080, fps = 30 } = options

  // Build video track — place clips sequentially
  let cursor = 0
  const videoClips: ShotstackClip[] = segments.map((seg) => {
    const clip: ShotstackClip = {
      asset: { type: 'video', src: seg.url },
      start: cursor,
      length: seg.durationSeconds,
      ...(seg.transitionIn || seg.transitionOut
        ? { transition: { in: seg.transitionIn, out: seg.transitionOut } }
        : {}),
    }
    cursor += seg.durationSeconds
    return clip
  })

  const tracks: ShotstackTrack[] = [{ clips: videoClips }]

  // Optional background music track
  if (options.backgroundMusic) {
    const totalDuration = cursor
    tracks.push({
      clips: [{
        asset: {
          type: 'audio',
          src: options.backgroundMusic.url,
        },
        start: 0,
        length: totalDuration,
        ...(options.backgroundMusic.fadeOut
          ? { transition: { out: 'fadeOut' } }
          : {}),
      }],
    })
  }

  const edit: ShotstackEdit = {
    timeline: { background: '#000000', tracks },
    output: {
      format: 'mp4',
      size: { width, height },
      fps,
      quality: 'high',
    },
  }

  return renderEdit(edit, outputPath)
}
