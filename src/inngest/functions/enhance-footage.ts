import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { inngest } from '../client.js'
import {
  stabilizeClip,
  addFade,
  generateScrollingTitleCard,
  generateEndCard,
  concatClips,
} from '../../services/ffmpeg.js'

// ─── Event type ───────────────────────────────────────────────────────────────

export type FootageEnhanceEvent = {
  name: 'footage/enhance-requested'
  data: {
    /** Path to the raw source footage (shaky phone video) */
    inputVideoPath: string
    /** Project directory — brand.json lives here, outputs are written here */
    projectDir: string
    /** Path to the intro video to prepend (e.g. logo-reveal.mp4). Optional. */
    introVideoPath?: string
    /** Lines of text for the scrolling title card between intro and main video. Optional. */
    scrollingLines?: string[]
    /** Title line for the end card (e.g. "Mustang dyno"). Optional. */
    endCardTitle?: string
    /** Stats line for the end card (e.g. "452HP / 532 FT-Lbs torque"). Optional. */
    endCardStats?: string
    /** Fade in duration in seconds. Default: 1 */
    fadeInSec?: number
    /** Fade out duration in seconds. Default: 1 */
    fadeOutSec?: number
    /** Stabilization options. Defaults to heavy stabilization for phone footage. */
    stabilization?: {
      shakiness?: number  // 1–10, default 10
      smoothing?: number  // default 30
    }
  }
}

// ─── Brand config (matches brand.json schema) ─────────────────────────────────

interface BrandColors {
  primary: string
  secondary: string
  text: string
  background: string
}

interface BrandConfig {
  name: string
  colors: BrandColors
}

// ─── Inngest function ─────────────────────────────────────────────────────────

export const enhanceFootage = inngest.createFunction(
  {
    id: 'enhance-footage',
    name: 'Enhance Footage',
    triggers: [{ event: 'footage/enhance-requested' }],
  },
  async ({ event, step }) => {
    const {
      inputVideoPath,
      projectDir,
      introVideoPath,
      scrollingLines,
      endCardTitle,
      endCardStats,
      fadeInSec = 1,
      fadeOutSec = 1,
      stabilization,
    } = event.data

    const PATHS = {
      brand:      path.join(projectDir, 'brand.json'),
      stabilized: path.join(projectDir, 'enhance-stabilized.mp4'),
      faded:      path.join(projectDir, 'enhance-faded.mp4'),
      titleCard:  path.join(projectDir, 'enhance-title-card.mp4'),
      endCard:    path.join(projectDir, 'enhance-end-card.mp4'),
      final:      path.join(projectDir, 'enhanced-final.mp4'),
    }

    // ── Step 1: Load brand config ──────────────────────────────────────────
    const brand = await step.run('load-brand-config', async (): Promise<BrandConfig> => {
      const raw = await fs.readFile(PATHS.brand, 'utf-8')
      return JSON.parse(raw) as BrandConfig
    })

    // ── Step 2: Stabilize footage (heavy — phone walking footage) ──────────
    await step.run('stabilize-footage', async () => {
      const result = await stabilizeClip(inputVideoPath, PATHS.stabilized, {
        shakiness: stabilization?.shakiness ?? 10,
        smoothing: stabilization?.smoothing ?? 30,
      })
      if (!result.ok) throw new Error(`Stabilization failed: ${result.error}`)
      return { output: PATHS.stabilized }
    })

    // ── Step 3: Add fade in/out ────────────────────────────────────────────
    await step.run('add-fades', async () => {
      const result = await addFade(PATHS.stabilized, PATHS.faded, fadeInSec, fadeOutSec)
      if (!result.ok) throw new Error(`Fade failed: ${result.error}`)
      await fs.unlink(PATHS.stabilized).catch(() => {})
      return { output: PATHS.faded }
    })

    // ── Step 4: Scrolling title card (optional) ────────────────────────────
    const hasTitleCard = Array.isArray(scrollingLines) && scrollingLines.length > 0
    await step.run('generate-title-card', async () => {
      if (!hasTitleCard) return { skipped: true }
      const result = await generateScrollingTitleCard(
        scrollingLines!,
        10,
        PATHS.titleCard,
        {
          color:   brand.colors.text,
          bgColor: brand.colors.background,
        }
      )
      if (!result.ok) throw new Error(`Title card failed: ${result.error}`)
      return { output: PATHS.titleCard }
    })

    // ── Step 5: End card (optional) ────────────────────────────────────────
    const hasEndCard = Boolean(endCardTitle && endCardStats)
    await step.run('generate-end-card', async () => {
      if (!hasEndCard) return { skipped: true }
      const result = await generateEndCard({
        titleText: endCardTitle!,
        statsText: endCardStats!,
        output: PATHS.endCard,
        brand: {
          primary:    brand.colors.primary,
          secondary:  brand.colors.secondary,
          text:       brand.colors.text,
          background: brand.colors.background,
        },
        durationSec: 4,
      })
      if (!result.ok) throw new Error(`End card failed: ${result.error}`)
      return { output: PATHS.endCard }
    })

    // ── Step 6: Assemble final — concat all segments in order ──────────────
    const finalOutput = await step.run('assemble-final', async (): Promise<string> => {
      const segments: string[] = []

      if (introVideoPath) {
        try { await fs.access(introVideoPath); segments.push(introVideoPath) }
        catch { console.warn(`[enhance] Intro not found at ${introVideoPath} — skipping`) }
      }

      if (hasTitleCard) segments.push(PATHS.titleCard)
      segments.push(PATHS.faded)
      if (hasEndCard) segments.push(PATHS.endCard)

      if (segments.length === 1) {
        // Only the main video — rename rather than concat
        await fs.rename(segments[0]!, PATHS.final)
        return PATHS.final
      }

      const result = await concatClips(segments, PATHS.final)
      if (!result.ok) throw new Error(`Assembly failed: ${result.error}`)

      // Clean up intermediate segments (but not the intro — it's owned by logo-reveal)
      await Promise.all([
        fs.unlink(PATHS.faded).catch(() => {}),
        hasTitleCard ? fs.unlink(PATHS.titleCard).catch(() => {}) : Promise.resolve(),
        hasEndCard   ? fs.unlink(PATHS.endCard).catch(() => {})   : Promise.resolve(),
      ])

      return PATHS.final
    })

    return {
      brand: brand.name,
      output: finalOutput,
      segments: {
        intro:     Boolean(introVideoPath),
        titleCard: hasTitleCard,
        mainVideo: true,
        endCard:   hasEndCard,
      },
    }
  }
)
