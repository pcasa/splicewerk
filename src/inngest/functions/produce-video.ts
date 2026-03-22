import * as fs from 'node:fs/promises'
import { inngest } from '../client.js'
import { catalogAssets } from '../../services/asset-catalog.js'
import { generateEDL } from '../../services/llm.js'
import { trimClip, loadFormatPresets, generateTitleCard, imageToClip } from '../../services/ffmpeg.js'
import { imageToVideo, textToVideo } from '../../services/runway.js'
import { uploadFile, assembleClips } from '../../services/shotstack.js'
import type { AssemblySegment, AssemblyOptions } from '../../services/shotstack.js'
import type { EDL, TimelineSegment } from '../../edl/types.js'
import { upsertRun, updateRunStatus, logCost } from '@splicewerk/db'

// ─── Types ───

type StepTools = {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>
  waitForEvent: (name: string, opts: unknown) => Promise<unknown>
}

type PipelineEvent = {
  name: 'video/production-requested'
  data: {
    prompt: string
    assetsDir: string
    formats: string[]
    projectName: string
    dryRun?: boolean
  }
}

// ─── Helpers ───

/** Parse "M:SS" or "SS.s" trim timestamps into seconds */
function parseTrimTime(t: string): number {
  const parts = t.trim().split(':')
  if (parts.length === 2) {
    return parseInt(parts[0]!, 10) * 60 + parseFloat(parts[1]!)
  }
  return parseFloat(t)
}

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'])

function isImageSource(filePath: string): boolean {
  const ext = '.' + (filePath.split('.').pop()?.toLowerCase() ?? '')
  return IMAGE_EXTS.has(ext)
}

function isVideoSource(filePath: string): boolean {
  const ext = '.' + (filePath.split('.').pop()?.toLowerCase() ?? '')
  return VIDEO_EXTS.has(ext)
}

/** Map any duration to nearest Runway-supported value (5 or 10 seconds) */
function clampRunwayDuration(seconds: number | undefined): 5 | 10 {
  if (!seconds || seconds < 7.5) return 5
  return 10
}

/** Infer missing processor from segment content */
function inferProcessor(seg: TimelineSegment, sourcePath: string | null): string | undefined {
  if (seg.processor) return seg.processor
  if (!sourcePath) return 'runway'           // no source → generated (text-to-video)
  if (isImageSource(sourcePath)) return 'runway'
  if (isVideoSource(sourcePath)) return 'ffmpeg'
  return undefined
}

// ─── Pipeline Handler (exported for testing) ───

export async function produceVideoPipeline(
  event: PipelineEvent,
  step: StepTools,
  runId: string
): Promise<{
  projectName: string
  edl: EDL | null
  masterPath: string | null
  outputs: string[]
  dryRun: boolean
}> {
  const { prompt, assetsDir, formats, projectName, dryRun = false } = event.data

  void upsertRun({ run_id: runId, function_id: 'produce-video', status: 'Running', started_at: new Date().toISOString(), prompt_used: prompt })
    .catch(err => console.warn('[DB] upsertRun failed:', err))

  // Step 1: Catalog assets
  const manifest = await step.run('catalog-assets', async () => {
    return catalogAssets(assetsDir)
  })

  // Step 2: Generate EDL
  const edlResult = await step.run('generate-edl', async () => {
    return generateEDL(prompt, manifest, undefined, runId)
  })

  // Step 3: Validate EDL
  const edl = await step.run('validate-edl', async (): Promise<EDL> => {
    if (!edlResult.ok) {
      throw new Error(`EDL generation failed: ${edlResult.error}`)
    }
    const edlValue = edlResult.value
    if (!edlValue.project) {
      throw new Error('Invalid EDL: missing required field "project"')
    }
    if (!Array.isArray(edlValue.timeline) || edlValue.timeline.length === 0) {
      throw new Error('Invalid EDL: "timeline" must be a non-empty array')
    }
    return edlValue
  })

  // dryRun: stop after validation
  if (dryRun) {
    return {
      projectName,
      edl,
      masterPath: null,
      outputs: [],
      dryRun: true,
    }
  }

  const renderedDir = `projects/${projectName}/rendered`
  const outputDir = `projects/${projectName}/output`

  // Step 4: Prepare output directories
  await step.run('prepare-output-dirs', async () => {
    await fs.mkdir(renderedDir, { recursive: true })
    await fs.mkdir(outputDir, { recursive: true })
  })

  // Step 5: Render segments → local paths + durations
  const renderedSegments = await step.run(
    'render-segments',
    async (): Promise<{ path: string; durationSeconds: number }[]> => {
      const results: { path: string; durationSeconds: number }[] = []

      // Build filename → full path lookup from the manifest
      const assetByFilename = new Map(
        manifest.files.map((f) => [f.filename.toLowerCase(), f.path])
      )
      // Also build a map keyed by the numeric portion of the filename (e.g. "0295" → path)
      // so LLM-hallucinated names like "0295.mp4" match actual files like "IMG_0295.MOV"
      const assetByNumber = new Map<string, string>()
      for (const f of manifest.files) {
        const nums = f.filename.match(/\d+/)
        if (nums) assetByNumber.set(nums[0]!, f.path)
      }
      const resolveSource = (source: string): string => {
        if (source.startsWith('/')) return source
        // 1. Exact match
        const exact = assetByFilename.get(source.toLowerCase())
        if (exact) return exact
        // 2. Strip extension and try again
        const noExt = source.replace(/\.[^.]+$/, '').toLowerCase()
        const noExtMatch = assetByFilename.get(noExt)
        if (noExtMatch) return noExtMatch
        // 3. Match by leading number sequence (e.g. "0295.mp4" → "0295" → IMG_0295.MOV)
        const nums = source.match(/\d+/)
        if (nums) {
          const numMatch = assetByNumber.get(nums[0]!)
          if (numMatch) return numMatch
        }
        return source
      }

      for (let i = 0; i < edl.timeline.length; i++) {
        const seg = edl.timeline[i] as TimelineSegment
        const outputPath = `${renderedDir}/seg${i + 1}.mp4`

        const sourcePath = seg.source ? resolveSource(seg.source) : null
        const processor = inferProcessor(seg, sourcePath)

        if (processor === 'runway') {
          // Runway: image → video only. Text/generated → ffmpeg title card (free).
          if (sourcePath && isImageSource(sourcePath)) {
            const duration = clampRunwayDuration(seg.durationSeconds)
            const segPrompt = seg.prompt ?? `Cinematic motion for: ${seg.type}`
            const runwayResult = await imageToVideo(sourcePath, segPrompt, duration)
            if (runwayResult.ok) {
              results.push({ path: runwayResult.value, durationSeconds: duration })
            } else {
              // Fallback: static image clip via ffmpeg (no Runway credits needed)
              console.warn(`[produce-video] Runway failed for ${seg.id} (${runwayResult.error}) — falling back to static ffmpeg clip`)
              const fallbackResult = await imageToClip(sourcePath, seg.durationSeconds ?? duration, outputPath)
              if (!fallbackResult.ok) throw new Error(`ffmpeg imageToClip fallback failed for ${seg.id}: ${fallbackResult.error}`)
              results.push({ path: outputPath, durationSeconds: seg.durationSeconds ?? duration })
            }
          } else {
            // No image source — generate a title card with ffmpeg
            const titleText = seg.textOverlay?.text ?? seg.prompt ?? seg.id
            const duration = seg.durationSeconds ?? 5
            const result = await generateTitleCard(titleText, duration, outputPath)
            if (!result.ok) throw new Error(`Title card failed for ${seg.id}: ${result.error}`)
            results.push({ path: outputPath, durationSeconds: duration })
          }

        } else if (processor === 'ffmpeg' && sourcePath) {
          if (seg.trim) {
            const [startStr, endStr] = seg.trim.split('-')
            const startSec = parseTrimTime(startStr ?? '0')
            const endSec = parseTrimTime(endStr ?? '0')
            const result = await trimClip(sourcePath, startSec, endSec, outputPath)
            if (!result.ok) throw new Error(`Failed to trim segment ${seg.id}: ${result.error}`)
            results.push({ path: outputPath, durationSeconds: endSec - startSec })
          } else {
            // No trim — use source directly, but verify file exists first
            const duration = seg.durationSeconds ?? 5
            try {
              await fs.access(sourcePath)
              results.push({ path: sourcePath, durationSeconds: duration })
            } catch {
              console.warn(`[produce-video] Skipping segment ${seg.id}: file not found at "${sourcePath}"`)
            }
          }
        } else {
          console.warn(`[produce-video] Skipping segment ${seg.id}: processor=${processor}, sourcePath=${sourcePath}`)
        }
      }

      return results
    }
  )

  // Step 6: Upload rendered segments to Shotstack ingest
  const hostedSegments = await step.run(
    'upload-segments',
    async (): Promise<AssemblySegment[]> => {
      const segments: AssemblySegment[] = []
      for (const seg of renderedSegments) {
        const result = await uploadFile(seg.path)
        if (!result.ok) throw new Error(`Shotstack upload failed for ${seg.path}: ${result.error}`)
        segments.push({ url: result.value, durationSeconds: seg.durationSeconds })
      }
      return segments
    }
  )

  // Step 7: Upload background music if it's a local file
  const musicAsset = await step.run(
    'upload-background-music',
    async (): Promise<{ url: string; volume: number; fadeOut?: number } | null> => {
      if (!edl.audio.backgroundMusic?.source) return null
      const { source, volume, fadeOut } = edl.audio.backgroundMusic
      if (source.startsWith('http://') || source.startsWith('https://')) {
        return { url: source, volume, fadeOut: fadeOut > 0 ? fadeOut : undefined }
      }
      // Skip if the local file doesn't exist (LLM may hallucinate filenames)
      try { await fs.access(source) } catch { return null }
      const result = await uploadFile(source)
      if (!result.ok) throw new Error(`Music upload failed: ${result.error}`)
      return { url: result.value, volume, fadeOut: fadeOut > 0 ? fadeOut : undefined }
    }
  )

  // Step 8: Assemble one output per format via Shotstack
  const outputs = await step.run('assemble-outputs', async (): Promise<string[]> => {
    const outputPaths: string[] = []
    const presets = loadFormatPresets()

    for (const format of formats) {
      const preset = presets[format]
      if (!preset) throw new Error(`Unknown format preset: ${format}`)

      const formatDir = `${outputDir}/${format}`
      await fs.mkdir(formatDir, { recursive: true })
      const outputPath = `${formatDir}/output.mp4`

      const options: AssemblyOptions = {
        width: preset.width,
        height: preset.height,
        fps: preset.fps,
      }
      if (musicAsset) {
        options.backgroundMusic = musicAsset
      }

      const result = await assembleClips(hostedSegments, outputPath, options)
      if (!result.ok) throw new Error(`Shotstack assembly failed for ${format}: ${result.error}`)
      outputPaths.push(result.value)
    }
    return outputPaths
  })

  void logCost({ run_id: runId, service: 'shotstack', operation: `render-${formats.join('+')}`, cost_usd: 0.10 * formats.length })
    .catch(err => console.warn('[DB] logCost (shotstack) failed:', err))

  // Step 9: Generate thumbnail (stub)
  await step.run('generate-thumbnail', async () => {
    return {
      thumbnailPath: `${outputDir}/thumbnail.jpg`,
      message: 'thumbnail generation pending CC-P4-01',
    }
  })

  const outputUrl = outputs[0] ?? null
  void updateRunStatus(runId, 'Completed', new Date().toISOString())
    .catch(err => console.warn('[DB] updateRunStatus failed:', err))

  if (outputUrl) {
    void upsertRun({ run_id: runId, function_id: 'produce-video', status: 'Completed', started_at: new Date().toISOString(), output_url: `/media/${outputUrl}`, prompt_used: prompt })
      .catch(err => console.warn('[DB] output_url upsert failed:', err))
  }

  return {
    projectName,
    edl,
    masterPath: null,  // assembled in Shotstack cloud, no local master
    outputs,
    dryRun: false,
  }
}

// ─── Inngest Function ───

export const produceVideo = inngest.createFunction(
  { id: 'produce-video', name: 'Produce Video', triggers: [{ event: 'video/production-requested' }] },
  async ({ event, step, runId }) => {
    return produceVideoPipeline(event as unknown as PipelineEvent, step as unknown as StepTools, runId)
  }
)
