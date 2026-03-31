import * as fs from 'node:fs/promises'
import { inngest } from '../client.js'
import { catalogAssets } from '../../services/asset-catalog.js'
import { generateEDL, validateVideoOutput } from '../../services/llm.js'
import { trimClip, loadFormatPresets, extractFrames } from '../../services/ffmpeg.js'
import { imageToVideo, textToVideo } from '../../services/runway.js'
import { uploadFile, assembleClips } from '../../services/shotstack.js'
import type { AssemblySegment, AssemblyOptions } from '../../services/shotstack.js'
import type { EDL, TimelineSegment } from '../../edl/types.js'

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

function isImageSource(filePath: string): boolean {
  const ext = '.' + (filePath.split('.').pop()?.toLowerCase() ?? '')
  return IMAGE_EXTS.has(ext)
}

// ─── Pipeline Handler (exported for testing) ───

export async function produceVideoPipeline(
  event: PipelineEvent,
  step: StepTools
): Promise<{
  projectName: string
  edl: EDL | null
  masterPath: string | null
  outputs: string[]
  dryRun: boolean
}> {
  const { prompt, assetsDir, formats, projectName, dryRun = false } = event.data

  // Step 1: Catalog assets
  const manifest = await step.run('catalog-assets', async () => {
    return catalogAssets(assetsDir)
  })

  // Step 2: Generate EDL
  const edlResult = await step.run('generate-edl', async () => {
    return generateEDL(prompt, manifest)
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
      const assetByNumber = new Map<string, string>()
      for (const f of manifest.files) {
        // Normalise the key so that "CAR‑CLIP‑01.MOV" and "car-clip-01.mov" map to the same entry
        const key = f.filename.toLowerCase()          // <-- force lower‑case (or any normalisation you prefer)
        assetByNumber.set(key, f.path)                // store with the normalised key
      }
      const resolveSource = (source: string): string => {
        if (source.startsWith('/')) return source
        return assetByFilename.get(source.toLowerCase()) ?? source
      }

      for (let i = 0; i < edl.timeline.length; i++) {
        const seg = edl.timeline[i] as TimelineSegment
        const outputPath = `${renderedDir}/seg${i + 1}.mp4`

        const sourcePath = seg.source ? resolveSource(seg.source) : null
        const sourceIsImage = sourcePath ? isImageSource(sourcePath) : false

        if (seg.processor === 'runway' || sourceIsImage) {
          // Runway: image → video or text → video
          const duration = (seg.durationSeconds === 5 || seg.durationSeconds === 10)
            ? seg.durationSeconds
            : 5
          const segPrompt = seg.prompt ?? `Cinematic motion for: ${seg.type}`

          if (sourcePath) {
            const result = await imageToVideo(sourcePath, segPrompt, duration)
            if (!result.ok) throw new Error(`Runway imageToVideo failed for ${seg.id}: ${result.error}`)
            results.push({ path: result.value, durationSeconds: duration })
          } else {
            const result = await textToVideo(segPrompt, duration)
            if (!result.ok) throw new Error(`Runway textToVideo failed for ${seg.id}: ${result.error}`)
            results.push({ path: result.value, durationSeconds: duration })
          }

        } else if (seg.processor === 'ffmpeg' && sourcePath) {
          if (seg.trim) {
            const [startStr, endStr] = seg.trim.split('-')
            const startSec = parseTrimTime(startStr ?? '0')
            const endSec = parseTrimTime(endStr ?? '0')
            const result = await trimClip(sourcePath, startSec, endSec, outputPath)
            if (!result.ok) throw new Error(`Failed to trim segment ${seg.id}: ${result.error}`)
            results.push({ path: outputPath, durationSeconds: endSec - startSec })
          } else {
            const duration = seg.durationSeconds ?? 5
            results.push({ path: sourcePath, durationSeconds: duration })
          }
        }
        // skip segments with no processor or unsupported processor (elevenlabs, etc.)
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

  // Step 9: Generate thumbnail (stub)
  await step.run('generate-thumbnail', async () => {
    return {
      thumbnailPath: `${outputDir}/thumbnail.jpg`,
      message: 'thumbnail generation pending CC-P4-01',
    }
  })

  // Step 10: Validate output — AI reviews frames against user description
  const validation = await step.run('validate-output', async () => {
    const firstOutput = outputs[0]
    if (!firstOutput) return null

    const framesDir = `${outputDir}/validation-frames`
    const framesResult = await extractFrames(firstOutput, 2, framesDir)
    if (!framesResult.ok) {
      console.warn(`[Validation] Frame extraction failed: ${framesResult.error}`)
      return null
    }

    const validationResult = await validateVideoOutput(framesResult.value, prompt)
    if (!validationResult.ok) {
      console.warn(`[Validation] Vision model failed: ${validationResult.error}`)
      return null
    }

    // Save result to local JSON file
    const validationPath = `projects/${projectName}/validation-${Date.now()}.json`
    const payload = { ...validationResult.value, projectName, timestamp: new Date().toISOString() }
    await fs.mkdir(`projects/${projectName}`, { recursive: true })
    await fs.writeFile(validationPath, JSON.stringify(payload, null, 2))
    console.log(`[Validation] Result saved to ${validationPath}`)

    // Clean up extracted frames
    await fs.rm(framesDir, { recursive: true, force: true })

    return validationResult.value
  })

  return {
    projectName,
    edl,
    masterPath: null,  // assembled in Shotstack cloud, no local master
    outputs,
    validation,
    dryRun: false,
  }
}

// ─── Inngest Function ───

export const produceVideo = inngest.createFunction(
  { id: 'produce-video', name: 'Produce Video', triggers: [{ event: 'video/production-requested' }] },
  async ({ event, step }) => {
    return produceVideoPipeline(event as unknown as PipelineEvent, step as unknown as StepTools)
  }
)
