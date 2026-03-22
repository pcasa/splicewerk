/**
 * Manual integration test for the Shotstack upload + render flow.
 * Run: DOTENV_CONFIG_PATH=.env npx tsx scripts/test-shotstack.ts
 *
 * Steps exercised:
 *   1. POST /upload   → get presigned S3 URL + source ID
 *   2. PUT to S3      → upload the file (tries multiple header strategies)
 *   3. GET /sources   → poll until status = 'ready', capture hosted URL
 *   4. POST /render   → submit a 1-clip timeline
 *   5. GET /render    → poll until status = 'done', download result
 */
import 'dotenv/config'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

// ─── Config ──────────────────────────────────────────────────────────────────

const SHOTSTACK_ENV = process.env.SHOTSTACK_ENV ?? 'stage'
const RENDER_BASE = `https://api.shotstack.io/edit/${SHOTSTACK_ENV}`
const INGEST_BASE = `https://api.shotstack.io/ingest/${SHOTSTACK_ENV}`
const API_KEY = process.env.SHOTSTACK_API_KEY ?? ''

// Use the first rendered segment if it exists, otherwise fall back to a small test file
const TEST_FILE =
  process.argv[2] ??
  'projects/autobahn-syndicate-intro-v2/rendered/seg1.mp4'

function hdrs(): Record<string, string> {
  return { 'x-api-key': API_KEY, 'Content-Type': 'application/json' }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── Step 1: Get presigned upload URL ────────────────────────────────────────

async function step1_getPresignedUrl(): Promise<{ id: string; uploadUrl: string }> {
  console.log('\n━━━ STEP 1: Get presigned upload URL ━━━')
  console.log(`  POST ${INGEST_BASE}/upload`)

  const res = await fetch(`${INGEST_BASE}/upload`, {
    method: 'POST',
    headers: hdrs(),
    body: JSON.stringify({}),
  })

  const text = await res.text()
  console.log(`  Response ${res.status}: ${text.slice(0, 200)}`)

  if (!res.ok) throw new Error(`Upload init failed: ${res.status} ${text}`)

  const json = JSON.parse(text) as { data: { id: string; attributes: { url: string } } }
  const { id, attributes: { url: uploadUrl } } = json.data

  console.log(`  Source ID: ${id}`)
  console.log(`  Upload URL host: ${new URL(uploadUrl).hostname}`)
  console.log(`  Upload URL query params:`)

  // Print each query param — critical for understanding what headers S3 expects
  const rawQuery = uploadUrl.split('?')[1] ?? ''
  for (const pair of rawQuery.split('&')) {
    const eqIdx = pair.indexOf('=')
    const key = decodeURIComponent(pair.slice(0, eqIdx))
    const rawVal = pair.slice(eqIdx + 1)
    // Truncate long values (security tokens)
    const display = rawVal.length > 60 ? rawVal.slice(0, 60) + '…' : rawVal
    console.log(`    ${key} = ${display}`)
  }

  return { id, uploadUrl }
}

// ─── Step 2: PUT file to S3 ───────────────────────────────────────────────────

async function step2_putToS3(uploadUrl: string, filePath: string): Promise<void> {
  console.log('\n━━━ STEP 2: PUT file to S3 ━━━')

  const { size } = await fs.stat(filePath)
  console.log(`  File: ${filePath} (${Math.round(size / 1024)}KB)`)

  const buffer = await fs.readFile(filePath)

  // Extract x-amz-* query params for use as headers.
  // Use raw decodeURIComponent — NOT URLSearchParams which decodes '+' as space
  // and would corrupt the AWS security token (base64 contains '+').
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

  console.log(`  x-amz headers being sent: ${Object.keys(amzHeaders).join(', ')}`)

  // Try strategy A: x-amz headers only (no Content-Type)
  console.log('\n  [Strategy A] x-amz headers only, no Content-Type')
  {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: amzHeaders,
      body: buffer,
    })
    const body = res.ok ? '' : (await res.text()).slice(0, 300)
    console.log(`  → ${res.status} ${res.ok ? 'OK ✓' : body}`)
    if (res.ok) {
      console.log('  Strategy A succeeded!')
      return
    }
  }

  // Try strategy B: Content-Type + x-amz headers
  console.log('\n  [Strategy B] Content-Type: video/mp4 + x-amz headers')
  {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4', ...amzHeaders },
      body: buffer,
    })
    const body = res.ok ? '' : (await res.text()).slice(0, 300)
    console.log(`  → ${res.status} ${res.ok ? 'OK ✓' : body}`)
    if (res.ok) {
      console.log('  Strategy B succeeded!')
      return
    }
  }

  // Try strategy C: no headers at all
  console.log('\n  [Strategy C] no headers')
  {
    const res = await fetch(uploadUrl, { method: 'PUT', body: buffer })
    const body = res.ok ? '' : (await res.text()).slice(0, 300)
    console.log(`  → ${res.status} ${res.ok ? 'OK ✓' : body}`)
    if (res.ok) {
      console.log('  Strategy C succeeded!')
      return
    }
  }

  throw new Error('All S3 PUT strategies failed — see output above for details')
}

// ─── Step 3: Poll until source is ready ──────────────────────────────────────

async function step3_pollSource(sourceId: string): Promise<string> {
  console.log(`\n━━━ STEP 3: Poll source ${sourceId} ━━━`)

  for (let i = 1; i <= 30; i++) {
    await sleep(4000)
    const res = await fetch(`${INGEST_BASE}/sources/${sourceId}`, {
      headers: { 'x-api-key': API_KEY },
    })
    if (!res.ok) throw new Error(`Source poll failed: ${res.status}`)

    const raw = await res.json() as Record<string, any>
    const attrs = raw?.data?.attributes ?? {}
    console.log(`  [${i}] status: ${attrs.status}  (full attrs keys: ${Object.keys(attrs).join(', ')})`)

    if (attrs.status === 'ready') {
      console.log(`  Full attributes: ${JSON.stringify(attrs, null, 2)}`)
      const url = attrs.url ?? attrs.source ?? attrs.hostedUrl
      console.log(`  Hosted URL: ${url}`)
      return url
    }
    if (attrs.status === 'failed') throw new Error(`Ingest failed for source ${sourceId}`)
    if (status === 'failed') throw new Error(`Ingest failed for source ${sourceId}`)
  }
  throw new Error('Ingest timed out')
}

// ─── Step 4+5: Submit render and poll ────────────────────────────────────────

async function step4_5_renderAndDownload(hostedUrl: string, durationSeconds: number): Promise<void> {
  console.log('\n━━━ STEP 4: Submit render ━━━')

  const edit = {
    timeline: {
      background: '#000000',
      tracks: [{
        clips: [{
          asset: { type: 'video', src: hostedUrl },
          start: 0,
          length: durationSeconds,
        }],
      }],
    },
    output: {
      format: 'mp4',
      size: { width: 1920, height: 1080 },
      fps: 30,
      quality: 'high',
    },
  }

  const res = await fetch(`${RENDER_BASE}/render`, {
    method: 'POST',
    headers: hdrs(),
    body: JSON.stringify(edit),
  })
  const text = await res.text()
  console.log(`  Response ${res.status}: ${text.slice(0, 300)}`)
  if (!res.ok) throw new Error(`Render submit failed: ${res.status} ${text}`)

  const json = JSON.parse(text) as Record<string, any>
  console.log(`  Full render submit response: ${JSON.stringify(json, null, 2).slice(0, 500)}`)
  const renderId = json?.data?.id ?? json?.response?.id
  console.log(`  Render ID: ${renderId}`)

  console.log('\n━━━ STEP 5: Poll render ━━━')
  for (let i = 1; i <= 60; i++) {
    await sleep(4000)
    const r = await fetch(`${RENDER_BASE}/render/${renderId}`, {
      headers: { 'x-api-key': API_KEY },
    })
    if (!r.ok) throw new Error(`Render poll failed: ${r.status}`)
    const rj = (await r.json()) as Record<string, any>
    const status = rj?.data?.status ?? rj?.response?.status
    const url = rj?.data?.url ?? rj?.response?.url
    console.log(`  [${i}] status: ${status}`)
    if (status === 'done') {
      console.log(`  Output URL: ${url}`)
      console.log('\n✓ Full Shotstack pipeline verified successfully')
      return
    }
    if (status === 'failed') throw new Error('Render failed')
  }
  throw new Error('Render timed out')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!API_KEY) {
    console.error('ERROR: SHOTSTACK_API_KEY not set in .env')
    process.exit(1)
  }

  try {
    await fs.access(TEST_FILE)
  } catch {
    console.error(`ERROR: Test file not found: ${TEST_FILE}`)
    console.error('Usage: npx tsx scripts/test-shotstack.ts <path-to-video.mp4>')
    process.exit(1)
  }

  console.log(`Shotstack env: ${SHOTSTACK_ENV}`)
  console.log(`Test file:     ${TEST_FILE}`)

  const { id: sourceId, uploadUrl } = await step1_getPresignedUrl()
  await step2_putToS3(uploadUrl, TEST_FILE)
  const hostedUrl = await step3_pollSource(sourceId)
  await step4_5_renderAndDownload(hostedUrl, 5)
}

main().catch((err) => {
  console.error('\n✗ Test failed:', err.message)
  process.exit(1)
})
