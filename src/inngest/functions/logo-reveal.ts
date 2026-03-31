import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import sharp from 'sharp'
import RunwayML from '@runwayml/sdk'
import { inngest } from '../client.js'
import { generateCinematicPrompt } from '../../services/llm.js'
import { uploadFile, renderEdit } from '../../services/shotstack.js'
import { upsertRun, updateRunStatus, logPrompt, logCost } from '@splicewerk/db'

const execFileAsync = promisify(execFile)

// ─── Event type ───────────────────────────────────────────────────────────────

export type LogoRevealEvent = {
  name: 'brand/logo-reveal-requested'
  data: {
    projectDir: string   // e.g. "projects/cinematic-intro"
    force?: boolean      // regenerate all cached assets
    forceRunway?: boolean
    baselinePrompt?: boolean  // skip Nemotron, use proven baseline
  }
}

// ─── Brand config (matches brand.json schema) ─────────────────────────────────

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

// ─── Baseline prompt (fallback if Nemotron fails) ─────────────────────────────

const RUNWAY_PROMPT_BASELINE = `Cinematic German automotive brand logo reveal on pure black background.
Dramatic deep red (#E02828) and turbo orange (#F46E2C) light rays burst outward from the logo.
Electric sparks and embers drift across the letters.
A wave of molten metallic shimmer sweeps left to right across the wordmark.
Dark smoke wisps rise slowly behind the logo.
Static locked-off camera, no zoom, no push-in — wide shot holds the full logo in frame.
Feels like a high-budget AMG, Porsche or BMW M-series commercial.
Pure black background, no environment — just the logo glowing against darkness.`

// ─── Inngest function ─────────────────────────────────────────────────────────

export const logoReveal = inngest.createFunction(
  {
    id: 'logo-reveal',
    name: 'Brand Logo Reveal',
    triggers: [{ event: 'brand/logo-reveal-requested' }],
  },
  async ({ event, step, runId }) => {
    const { projectDir, force = false, forceRunway = false, baselinePrompt = false } = event.data

    const PATHS = {
      brand:       path.join(projectDir, 'brand.json'),
      transparent: path.join(projectDir, 'logo-transparent.png'),
      runwayInput: path.join(projectDir, 'logo-on-black.jpg'),
      audio:       path.join(projectDir, 'engine.mp3'),
      runwayVideo: path.join(projectDir, 'runway-logo.mp4'),
      rawVideo:    path.join(projectDir, 'logo-reveal-raw.mp4'),
      final:       path.join(projectDir, 'logo-reveal.mp4'),
    }

    const isCached = async (p: string) => {
      if (force) return false
      try { const s = await fs.stat(p); return s.size > 0 } catch { return false }
    }

    void upsertRun({ run_id: runId, function_id: 'logo-reveal', status: 'Running', started_at: new Date().toISOString() })
      .catch(err => console.warn('[DB] upsertRun failed:', err))

    // ── Step 1: Load brand config ──────────────────────────────────────────────
    const brand = await step.run('load-brand-config', async (): Promise<BrandConfig> => {
      const raw = await fs.readFile(PATHS.brand, 'utf-8')
      return JSON.parse(raw) as BrandConfig
    })

    // ── Step 2: Image prep (sharp — free, local) ───────────────────────────────
    await step.run('prepare-logo-image', async () => {
      if (await isCached(PATHS.runwayInput)) return { cached: true }

      const image = sharp(brand.assets.logo)
      const { width, height } = await image.metadata()
      if (!width || !height) throw new Error('Could not read logo dimensions')

      const { data } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const pixels = new Uint8Array(data)
      const [bgR, bgG, bgB] = [pixels[0]!, pixels[1]!, pixels[2]!]
      const TOLERANCE = 30
      for (let i = 0; i < pixels.length; i += 4) {
        if (Math.abs(pixels[i]! - bgR) + Math.abs(pixels[i+1]! - bgG) + Math.abs(pixels[i+2]! - bgB) < TOLERANCE) {
          pixels[i+3] = 0
        }
      }
      await sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } }).png().toFile(PATHS.transparent)

      const logoBuffer = await sharp(PATHS.transparent)
        .resize(Math.round(1920 * 0.70), Math.round(1080 * 0.35), { fit: 'inside', withoutEnlargement: false })
        .sharpen({ sigma: 1.5 })
        .png()
        .toBuffer()

      await sharp({ create: { width: 1920, height: 1080, channels: 3, background: { r: 0, g: 0, b: 0 } } })
        .composite([{ input: logoBuffer, gravity: 'centre' }])
        .jpeg({ quality: 95 })
        .toFile(PATHS.runwayInput)

      return { cached: false }
    })

    // ── Step 3: Nemotron generates Runway prompt (AI → AI) ─────────────────────
    const runwayPrompt = await step.run('nemotron-generate-prompt', async (): Promise<string> => {
      if (baselinePrompt) return RUNWAY_PROMPT_BASELINE

      const result = await generateCinematicPrompt(
        {
          brandName: brand.name,
          tagline:   brand.tagline,
          industry:  brand.industry,
          colors:    { primary: brand.colors.primary, secondary: brand.colors.secondary, accent: brand.colors.accent },
          mood:      `${brand.mood}\n\nBrand context: ${brand.nemotronContext}`,
        },
        PATHS.runwayInput
      )

      if (!result.ok) {
        console.warn(`[Nemotron] Failed: ${result.error} — using baseline prompt`)
        return RUNWAY_PROMPT_BASELINE
      }

      return result.value
        .replace(/^(logo animation prompt|prompt|here'?s? (the|a) prompt)[:\s]*/i, '')
        .trim()
        .slice(0, 999)
    })

    void logPrompt({
      run_id: runId,
      source: baselinePrompt ? 'pipeline-baseline' : 'pipeline',
      step: 'nemotron-generate-prompt',
      model: 'nvidia/nemotron-nano-12b-v2-vl',
      messages_in: [{ role: 'user', content: `Brand: ${brand.name} | Industry: ${brand.industry} | Mood: ${brand.mood}` }],
      response_out: runwayPrompt,
      metadata: { brand: brand.name, baselinePrompt, forceRunway, projectDir },
    }).catch(err => console.warn('[DB] logPrompt failed:', err))

    // ── Step 4: Approval gate — runs before any credit spend ──────────────────
    // If Runway video is already cached, skip the gate (no credits will be spent).
    // Otherwise pause and wait for you to send "brand/approved" from Inngest dashboard.
    const runwayIsCached = !forceRunway && !force && await isCached(PATHS.runwayVideo)
    if (!runwayIsCached) {
      console.log(`\n⏸  APPROVAL REQUIRED before Runway generation (~125 credits)`)
      console.log(`   Prompt: ${runwayPrompt.slice(0, 120)}...`)
      console.log(`   Send event "brand/approved" in Inngest to proceed.\n`)

      const approval = await step.waitForEvent('wait-for-approval', {
        event: 'brand/approved',
        timeout: '24h',
      })

      if (!approval) throw new Error('Approval timed out — Runway generation cancelled. No credits spent.')
      console.log('   ✓ Approved — starting Runway generation')
    }

    // ── Step 5: Runway Gen-4 visual FX (~60s, costs credits) ──────────────────
    // Split into: create task → durable sleep+poll loop (no blocking setTimeout).
    // Each step.sleep() is a serverless-safe checkpoint — the function suspends
    // between polls instead of holding an execution slot for up to 5 minutes.
    const RUNWAY_MAX_POLLS = 60  // 60 × 5s = 5 min ceiling
    const runwayTaskId = await step.run('runway-create-task', async (): Promise<string | null> => {
      if (runwayIsCached) return null

      const apiKey = process.env.RUNWAY_API_KEY
      if (!apiKey) throw new Error('RUNWAY_API_KEY not set')
      const client = new RunwayML({ apiKey })

      const buffer = await fs.readFile(PATHS.runwayInput)
      const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`

      const task = await client.imageToVideo.create({
        model: 'gen4_turbo',
        promptImage: dataUrl,
        promptText: runwayPrompt,
        duration: 10,
        ratio: '1280:720',
      })
      return task.id
    })

    if (runwayTaskId !== null) {
      let runwayDone = false
      for (let poll = 1; poll <= RUNWAY_MAX_POLLS; poll++) {
        await step.sleep(`runway-poll-wait-${poll}`, '5s')

        const done = await step.run(`runway-poll-check-${poll}`, async (): Promise<boolean> => {
          const apiKey = process.env.RUNWAY_API_KEY!
          const client = new RunwayML({ apiKey })
          const status = await client.tasks.retrieve(runwayTaskId)
          if (status.status === 'SUCCEEDED') {
            const res = await fetch(status.output[0])
            await fs.writeFile(PATHS.runwayVideo, Buffer.from(await res.arrayBuffer()))
            return true
          }
          if (status.status === 'FAILED') throw new Error(`Runway failed: ${status.failure}`)
          return false
        })

        if (done) { runwayDone = true; break }
      }
      if (!runwayDone) throw new Error('Runway timed out after 5 minutes')
    }

    if (!runwayIsCached) {
      void logCost({ run_id: runId, service: 'runway', operation: 'image-to-video-gen4-turbo-10s', units: 125, unit_type: 'credits', cost_usd: 1.25 })
        .catch(err => console.warn('[DB] logCost (runway) failed:', err))
    }

    // ── Step 5: Audio source — upload raw MOV directly (Nemotron recommendation) ─
    // Nemotron advised: skip the MP3 intermediate entirely to avoid double re-encoding.
    // Upload the original MOV to Shotstack — it extracts the audio track natively,
    // encodes once to AAC, preserving the original dynamics and quality.
    const audioPath = await step.run('select-audio-source', async (): Promise<string | null> => {
      const footageSources = [
        { file: 'projects/test-intro/raw/IMG_0294.MOV', start: 0, duration: 7 },
        { file: 'projects/test-intro/raw/IMG_0293.MOV', start: 5, duration: 10 },
        { file: 'projects/test-intro/raw/IMG_0295.MOV', start: 0, duration: 10 },
      ]
      for (const src of footageSources) {
        try {
          await fs.access(src.file)
          console.log(`[audio] Using raw MOV: ${src.file} (${src.start}s–${src.start + src.duration}s)`)
          return src.file   // return raw MOV path — no ffmpeg extraction
        } catch { /* try next */ }
      }
      return null
    })

    // ── Step 6: Shotstack composite (video + audio) ────────────────────────────
    const { videoUrl, audioUrl } = await step.run('shotstack-upload', async () => {
      const [videoUp, audioUp] = await Promise.all([
        uploadFile(PATHS.runwayVideo),
        audioPath ? uploadFile(audioPath) : Promise.resolve(null),
      ])
      if (!videoUp.ok) throw new Error(`Video upload failed: ${videoUp.error}`)
      return {
        videoUrl: videoUp.value,
        audioUrl: audioUp?.ok ? audioUp.value : null,
      }
    })

    await step.run('shotstack-render', async () => {
      const tracks = [
        {
          clips: [{
            asset: { type: 'video' as const, src: videoUrl },
            start: 0, length: 10, fit: 'cover',
            transition: { out: 'fade' },
          }],
        },
        ...(audioUrl ? [{
          clips: [{ asset: { type: 'audio' as const, src: audioUrl }, start: 0, length: 10 }],
        }] : []),
      ]

      const edit = {
        timeline: { background: '#000000', tracks },
        output: { format: 'mp4' as const, size: { width: 1920, height: 1080 }, fps: 30, quality: 'high' as const },
      }

      const result = await renderEdit(edit, PATHS.rawVideo)
      if (!result.ok) throw new Error(`Shotstack failed: ${result.error}`)
      return { path: PATHS.rawVideo }
    })

    void logCost({ run_id: runId, service: 'shotstack', operation: 'render-1080p-30fps', cost_usd: 0.10 })
      .catch(err => console.warn('[DB] logCost (shotstack) failed:', err))

    // ── Step 7: Burn tagline with brand fonts/colors ───────────────────────────
    await step.run('burn-tagline', async () => {
      const tagline = brand.tagline.toUpperCase()
      const { fonts, colors } = brand
      const svgContent = `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="dropshadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="black" flood-opacity="1"/>
          </filter>
        </defs>
        <text
          x="960" y="800"
          text-anchor="middle" dominant-baseline="middle"
          font-family="${fonts.heading}, Helvetica, Arial, sans-serif"
          font-size="32" font-weight="${fonts.weight}"
          letter-spacing="${fonts.letterSpacing}"
          fill="${colors.text}" opacity="${fonts.taglineOpacity}"
          filter="url(#dropshadow)"
        >${tagline}</text>
      </svg>`

      const taglineOverlayPath = PATHS.final.replace('.mp4', '-tagline.png')
      await sharp(Buffer.from(svgContent)).png().toFile(taglineOverlayPath)

      await execFileAsync('ffmpeg', [
        '-y',
        '-i', PATHS.rawVideo,
        '-loop', '1', '-i', taglineOverlayPath,
        '-filter_complex', '[1:v]fade=t=in:st=7.5:d=0.5:alpha=1,fade=t=out:st=9.5:d=0.5:alpha=1[txt];[0:v][txt]overlay=0:0:shortest=1',
        '-c:a', 'copy',
        PATHS.final,
      ])

      await fs.unlink(PATHS.rawVideo).catch(() => {})
      await fs.unlink(taglineOverlayPath).catch(() => {})
      return { output: PATHS.final }
    })

    void updateRunStatus(runId, 'Completed', new Date().toISOString())
      .catch(err => console.warn('[DB] updateRunStatus failed:', err))

    return {
      brand: brand.name,
      output: PATHS.final,
      prompt: runwayPrompt,
    }
  }
)
