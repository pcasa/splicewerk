/**
 * Autobahn Syndicate — AI Cinematic Logo Reveal
 *
 * Step-based pipeline (cheap/fast → expensive):
 *   Step 1: Image prep   — sharp (local, free,   ~2s)
 *   Step 2: Audio        — ffmpeg extract > local file > ElevenLabs > CC0 download
 *   Step 3: Visual FX    — Runway Gen-4 (credits, ~60s)
 *   Step 4: Assemble     — Shotstack (~30s)
 *
 * Each step caches its output. Re-runs skip completed steps automatically.
 * See docs/brand-intro-workflow.md for full decision log and tuning guide.
 *
 * Usage:
 *   npx tsx scripts/logo-reveal.ts               # use cached assets
 *   npx tsx scripts/logo-reveal.ts --force        # regenerate everything
 *   npx tsx scripts/logo-reveal.ts --force-runway # new Runway generation only
 *   npx tsx scripts/logo-reveal.ts --skip-audio
 */
import 'dotenv/config'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import sharp from 'sharp'
import RunwayML from '@runwayml/sdk'
import { renderEdit, uploadFile } from '../src/services/shotstack.js'
import { generateCinematicPrompt } from '../src/services/llm.js'
import type { BrandContext } from '../src/services/llm.js'
import { generateSFX } from '../src/services/elevenlabs.js'

const execFileAsync = promisify(execFile)

// ─── CLI flags ────────────────────────────────────────────────────────────────

const FORCE         = process.argv.includes('--force')
const FORCE_RUNWAY  = process.argv.includes('--force-runway') || FORCE
const SKIP_AUDIO    = process.argv.includes('--skip-audio')

// ─── Project config ───────────────────────────────────────────────────────────

const OUTPUT_DIR = 'projects/cinematic-intro'
const BRAND_CONFIG_PATH = path.join(OUTPUT_DIR, 'brand.json')

interface BrandConfig {
  name: string
  tagline: string
  industry: string
  mood: string
  colors: { primary: string; secondary: string; accent: string; background: string; text: string }
  fonts: { heading: string; body: string; weight: string; letterSpacing: string; taglineOpacity: number }
  assets: { logo: string }
  nemotronContext: string
}

async function loadBrandConfig(): Promise<BrandConfig> {
  const raw = await fs.readFile(BRAND_CONFIG_PATH, 'utf-8')
  return JSON.parse(raw) as BrandConfig
}

// Loaded at startup in main() — available globally after that
let BRAND_CFG: BrandConfig

// Derived BrandContext for LLM calls — includes the nemotronContext prompt
function toBrandContext(cfg: BrandConfig): BrandContext {
  return {
    brandName: cfg.name,
    tagline:   cfg.tagline,
    industry:  cfg.industry,
    colors:    { primary: cfg.colors.primary, secondary: cfg.colors.secondary, accent: cfg.colors.accent },
    mood:      `${cfg.mood}\n\nBrand context for AI: ${cfg.nemotronContext}`,
  }
}

const PATHS = {
  transparent:  path.join(OUTPUT_DIR, 'logo-transparent.png'),
  runwayInput:  path.join(OUTPUT_DIR, 'logo-on-black.jpg'),
  audio:        path.join(OUTPUT_DIR, 'engine.mp3'),
  runwayVideo:  path.join(OUTPUT_DIR, 'runway-logo.mp4'),
  final:        path.join(OUTPUT_DIR, 'logo-reveal.mp4'),
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true if file exists AND we are not in --force mode */
async function isCached(filePath: string): Promise<boolean> {
  if (FORCE) return false
  try {
    await fs.access(filePath)
    const { size } = await fs.stat(filePath)
    return size > 0
  } catch {
    return false
  }
}

// ─── Step 1: Image prep ───────────────────────────────────────────────────────

async function prepareImages(): Promise<void> {
  if (await isCached(PATHS.runwayInput)) {
    console.log('   ↩ logo-on-black.jpg cached — skipping image prep')
    return
  }

  // 1a: Remove near-black background
  const image = sharp(BRAND_CFG.assets.logo)
  const { width, height } = await image.metadata()
  if (!width || !height) throw new Error('Could not read image dimensions')
  const { data } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const pixels = new Uint8Array(data)
  const [bgR, bgG, bgB] = [pixels[0], pixels[1], pixels[2]]
  console.log(`   Background sampled: rgb(${bgR}, ${bgG}, ${bgB})`)
  const TOLERANCE = 30
  for (let i = 0; i < pixels.length; i += 4) {
    if (Math.abs(pixels[i]-bgR!) + Math.abs(pixels[i+1]-bgG!) + Math.abs(pixels[i+2]-bgB!) < TOLERANCE) {
      pixels[i+3] = 0
    }
  }
  await sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } })
    .png().toFile(PATHS.transparent)

  // 1b: Composite on 1920×1080 black canvas
  const logoBuffer = await sharp(PATHS.transparent)
    .resize(Math.round(1920 * 0.70), Math.round(1080 * 0.35), { fit: 'inside', withoutEnlargement: false })
    .sharpen({ sigma: 1.5 })
    .png()
    .toBuffer()
  await sharp({ create: { width: 1920, height: 1080, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{ input: logoBuffer, gravity: 'centre' }])
    .jpeg({ quality: 95 })
    .toFile(PATHS.runwayInput)

  console.log(`   ✓ logo-on-black.jpg ready`)
}

// ─── Step 2: Audio ────────────────────────────────────────────────────────────
// Priority order (cheapest/fastest first — see docs/brand-intro-workflow.md):
//   1. ffmpeg extract from existing project footage (free, authentic sound)
//   2. Local file drop-in (GarageBand export / manual download)
//   3. Free CC0 download from BigSoundBank
//   4. ElevenLabs AI generation (costs credits — last resort)

// Source footage — ordered by measured audio energy (see docs/brand-intro-workflow.md)
// IMG_0293 at 5s = -14.9 dB RMS (most energetic of all segments tested)
const FOOTAGE_SOURCES = [
  { file: 'projects/test-intro/raw/IMG_0293.MOV', start: 5,  duration: 10 }, // -14.9 dB ← best
  { file: 'projects/test-intro/raw/IMG_0293.MOV', start: 0,  duration: 10 }, // -16.9 dB
  { file: 'projects/test-intro/raw/IMG_0295.MOV', start: 0,  duration: 10 }, // -17.6 dB
  { file: 'projects/test-intro/raw/IMG_0294.MOV', start: 0,  duration: 10 }, // -25.1 dB
]

const LOCAL_AUDIO_SOURCES = [
  'projects/test-intro/raw/engine.mp3',
  'projects/test-intro/raw/engine.wav',
  'projects/test-intro/raw/audio.mp3',
]

const FREE_AUDIO_URL = 'https://bigsoundbank.com/UPLOAD/mp3/0189.mp3' // CC0 sports car

async function extractAudioFromFootage(): Promise<string | null> {
  for (const src of FOOTAGE_SOURCES) {
    try {
      await fs.access(src.file)
      console.log(`   Extracting audio from ${path.basename(src.file)}...`)
      await execFileAsync('ffmpeg', [
        '-y',
        '-ss', String(src.start),
        '-i', src.file,
        '-t', String(src.duration),
        '-vn',                     // no video
        '-acodec', 'libmp3lame',
        '-q:a', '2',               // high quality VBR
        '-af', 'afade=t=out:st=8:d=2', // 2s fade-out starting at 8s
        PATHS.audio,
      ])
      const { size } = await fs.stat(PATHS.audio)
      console.log(`   ✓ Extracted ${Math.round(size/1024)}KB from ${path.basename(src.file)}`)
      return PATHS.audio
    } catch (err) {
      console.warn(`   ⚠ Extraction failed for ${src.file}: ${err instanceof Error ? err.message : err}`)
    }
  }
  return null
}

async function prepareAudio(): Promise<string | null> {
  if (SKIP_AUDIO) {
    console.log('   ↩ --skip-audio flag set')
    return null
  }

  if (await isCached(PATHS.audio)) {
    console.log('   ↩ engine.mp3 cached — skipping audio prep')
    return PATHS.audio
  }

  // 1. Extract from existing footage (authentic, free)
  const extracted = await extractAudioFromFootage()
  if (extracted) return extracted

  // 2. Local file drop-in
  for (const src of LOCAL_AUDIO_SOURCES) {
    try {
      await fs.access(src)
      console.log(`   ✓ Using local file: ${src}`)
      await fs.copyFile(src, PATHS.audio)
      return PATHS.audio
    } catch { /* not found */ }
  }

  // 3. Free CC0 download
  console.log('   ↓ Downloading free CC0 engine sound...')
  try {
    const res = await fetch(FREE_AUDIO_URL)
    if (res.ok) {
      const buf = await res.arrayBuffer()
      await fs.writeFile(PATHS.audio, Buffer.from(buf))
      console.log(`   ✓ Downloaded ${Math.round(buf.byteLength/1024)}KB`)
      return PATHS.audio
    }
  } catch { /* fall through */ }

  // 4. ElevenLabs (costs credits)
  console.log('   → Trying ElevenLabs...')
  const sfx = await generateSFX(
    'German performance car cold engine start, deep V8 idle rumble building into dramatic rev and turbo whoosh, AMG exhaust roar, cinematic',
    5
  )
  if (sfx.ok) {
    await fs.copyFile(sfx.value, PATHS.audio)
    console.log('   ✓ ElevenLabs audio ready')
    return PATHS.audio
  }
  console.warn(`   ⚠ ElevenLabs: ${sfx.error}`)
  console.warn('   → No audio available. Drop an MP3 at projects/test-intro/raw/engine.mp3 to add sound.')
  return null
}

// ─── Runway prompts ───────────────────────────────────────────────────────────
// Proven prompts are saved here. Use the baseline unless experimenting.
// See docs/brand-intro-workflow.md for prompt strategy.

// NIM recommended: static wide shot, no camera movement — keeps logo in frame so tagline fits below.
// Effects still cinematic but camera stays locked off.
const RUNWAY_PROMPT_BASELINE = `Cinematic German automotive brand logo reveal on pure black background.
Dramatic deep red (#E02828) and turbo orange (#F46E2C) light rays burst outward from the logo.
Electric sparks and embers drift across the letters.
A wave of molten metallic shimmer sweeps left to right across the wordmark.
Dark smoke wisps rise slowly behind the logo.
Static locked-off camera, no zoom, no push-in — wide shot holds the full logo in frame.
Feels like a high-budget AMG, Porsche or BMW M-series commercial.
Pure black background, no environment — just the logo glowing against darkness.`

// ─── Step 3: Runway video ─────────────────────────────────────────────────────

async function prepareRunwayVideo(): Promise<string> {
  if (!FORCE_RUNWAY && await isCached(PATHS.runwayVideo)) {
    console.log('   ↩ runway-logo.mp4 cached — skipping Runway (use --force-runway to regenerate)')
    return PATHS.runwayVideo
  }

  // Nemotron (via NIM) generates the Runway prompt by default — core of the AI-to-AI POC.
  // Vision model analyzes the actual logo image; falls back to text model, then baseline.
  // Pass --baseline-prompt to skip Nemotron and use the hardcoded proven prompt.
  let prompt = RUNWAY_PROMPT_BASELINE
  if (!process.argv.includes('--baseline-prompt')) {
    console.log('🤖 Nemotron analyzing logo → generating Runway prompt...')
    const nemotronResult = await generateCinematicPrompt(toBrandContext(BRAND_CFG), PATHS.runwayInput)
    if (nemotronResult.ok) {
      // Strip any preamble Nemotron adds (e.g. "Logo animation prompt: ...")
      prompt = nemotronResult.value
        .replace(/^(logo animation prompt|prompt|here'?s? (the|a) prompt)[:\s]*/i, '')
        .trim()
        .slice(0, 999)
      console.log(`   ✓ Nemotron prompt (${prompt.length} chars):\n   ${prompt.slice(0, 120)}...`)
    } else {
      console.warn(`   ⚠ Nemotron failed (${nemotronResult.error}) — using baseline prompt`)
    }
  }

  const apiKey = process.env.RUNWAY_API_KEY
  if (!apiKey) throw new Error('RUNWAY_API_KEY not set')
  const client = new RunwayML({ apiKey })

  const buffer = await fs.readFile(PATHS.runwayInput)
  const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`

  console.log('🚀 Sending to Runway Gen-4...')
  const task = await client.imageToVideo.create({
    model: 'gen4_turbo',
    promptImage: dataUrl,
    promptText: prompt,
    duration: 10,
    ratio: '1280:720',
  })
  console.log(`   Task ID: ${task.id}`)

  for (let i = 1; i <= 60; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const status = await client.tasks.retrieve(task.id)
    console.log(`   [${i}] ${status.status}`)
    if (status.status === 'SUCCEEDED') {
      const res = await fetch(status.output[0])
      await fs.writeFile(PATHS.runwayVideo, Buffer.from(await res.arrayBuffer()))
      console.log(`   ✓ runway-logo.mp4 saved`)
      return PATHS.runwayVideo
    }
    if (status.status === 'FAILED') throw new Error(`Runway failed: ${status.failure}`)
  }
  throw new Error('Runway timed out')
}

// ─── Step 4: Composite (Shotstack) ────────────────────────────────────────────

async function composite(audioPath: string | null): Promise<void> {
  console.log('\n📤 Uploading to Shotstack...')

  const [videoUp, audioUp] = await Promise.all([
    uploadFile(PATHS.runwayVideo),
    audioPath ? uploadFile(audioPath) : Promise.resolve(null),
  ])

  if (!videoUp.ok) throw new Error(`Video upload failed: ${videoUp.error}`)
  console.log('   ✓ Video uploaded')

  const audioUrl = audioUp?.ok ? audioUp.value : null
  if (audioPath && !audioUp?.ok) console.warn(`   ⚠ Audio upload failed: ${audioUp?.error}`)
  if (audioUrl) console.log('   ✓ Audio uploaded')

  const tagline = BRAND_CFG.tagline.toUpperCase()

  // Build tracks as a plain array so Shotstack receives clean JSON.
  // Track order: index 0 = top layer, last index = bottom layer.
  // Audio is separate from video — effect goes on the clip, not inside asset.
  const videoTrack = {
    clips: [{
      asset: { type: 'video', src: videoUp.value },
      start: 0,
      length: 10,
      fit: 'cover',
      transition: { out: 'fade' },
    }],
  }

  const audioTrack = audioUrl ? {
    clips: [{
      asset: { type: 'audio', src: audioUrl },
      start: 0,
      length: 10,
    }],
  } : null

  // Shotstack title clips always render at center regardless of position/offset.
  // Omit title from Shotstack — we burn it in with ffmpeg at exact pixel position instead.
  const tracks = [
    videoTrack,
    ...(audioTrack ? [audioTrack] : []),
  ]

  const edit = {
    timeline: {
      background: '#000000',
      tracks,
    },
    output: { format: 'mp4' as const, size: { width: 1920, height: 1080 }, fps: 30, quality: 'high' as const },
  }

  console.log('\n🎞  Compositing via Shotstack...')
  const shotstackPath = PATHS.final.replace('.mp4', '-raw.mp4')
  const result = await renderEdit(edit, shotstackPath)
  if (!result.ok) throw new Error(`Shotstack failed: ${result.error}`)

  // Burn tagline using sharp (SVG → PNG) + ffmpeg overlay filter.
  // The bottled ffmpeg lacks --enable-libfreetype, so drawtext is unavailable.
  // Instead: render text to a transparent 1920×1080 PNG with sharp, then use
  // ffmpeg's built-in overlay + fade filters (no extra libs required).
  console.log('✏️  Burning tagline with sharp + ffmpeg overlay...')
  const taglineOverlayPath = PATHS.final.replace('.mp4', '-tagline.png')

  // Build an SVG tagline using brand.json for font, color, and opacity.
  // Logo occupies ~35% of frame height, centered → bottom edge ≈ y=729.
  // Tagline sits below that at y=800, matching the stacked layout on autobahnsyndicate.com.
  const { fonts, colors } = BRAND_CFG
  const svgWidth = 1920
  const svgHeight = 1080
  const textY = 800
  const svgContent = `<svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="dropshadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="black" flood-opacity="1"/>
      </filter>
    </defs>
    <text
      x="${svgWidth / 2}"
      y="${textY}"
      text-anchor="middle"
      dominant-baseline="middle"
      font-family="${fonts.heading}, Helvetica, Arial, sans-serif"
      font-size="32"
      font-weight="${fonts.weight}"
      letter-spacing="${fonts.letterSpacing}"
      fill="${colors.text}"
      opacity="${fonts.taglineOpacity}"
      filter="url(#dropshadow)"
    >${tagline}</text>
  </svg>`

  await sharp(Buffer.from(svgContent))
    .png()
    .toFile(taglineOverlayPath)

  // Overlay with alpha fade: in at 7.5s, hold, out at 9.5s
  // [1:v] fade filter with alpha=1 operates on the alpha channel of the transparent PNG
  await execFileAsync('ffmpeg', [
    '-y',
    '-i', shotstackPath,
    '-loop', '1', '-i', taglineOverlayPath,
    '-filter_complex',
    '[1:v]fade=t=in:st=7.5:d=0.5:alpha=1,fade=t=out:st=9.5:d=0.5:alpha=1[txt];[0:v][txt]overlay=0:0:shortest=1',
    '-c:a', 'copy',
    PATHS.final,
  ])

  await fs.unlink(shotstackPath).catch(() => {})
  await fs.unlink(taglineOverlayPath).catch(() => {})
  console.log(`\n✓ Done! → ${PATHS.final}`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Load brand config — single source of truth for all brand settings
  BRAND_CFG = await loadBrandConfig()
  console.log(`\n🎬 ${BRAND_CFG.name} — AI Logo Reveal`)
  console.log(`   Brand: ${BRAND_CFG.tagline} | Font: ${BRAND_CFG.fonts.heading} | Primary: ${BRAND_CFG.colors.primary}`)
  if (FORCE) console.log('   (--force: regenerating all assets)')
  console.log()

  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  // Step 1: Image (free, local)
  console.log('🖼  Preparing images...')
  await prepareImages()

  // Step 2: Audio (ElevenLabs — credits, fast) — BEFORE Runway
  console.log('🔊 Preparing audio...')
  const audioPath = await prepareAudio()

  // Step 3: Runway video (credits, slow)
  console.log('🎥 Preparing Runway video...')
  await prepareRunwayVideo()

  // Step 4: Composite
  await composite(audioPath)

  console.log(`\n  Preview: open "${PATHS.final}"`)
}

main().catch(err => { console.error('\n✗ Failed:', err.message); process.exit(1) })
