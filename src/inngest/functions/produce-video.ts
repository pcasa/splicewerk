import * as fs from 'node:fs/promises'
import { inngest } from '../client.js'
import { catalogAssets } from '../../services/asset-catalog.js'
import { generateEDL } from '../../services/llm.js'
import { trimClip, concatClips, reformat, mixAudio } from '../../services/ffmpeg.js'
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

  // Step 5: Render segments
  const segmentPaths = await step.run('render-segments', async (): Promise<string[]> => {
    const paths: string[] = []
    const ffmpegSegments = edl.timeline.filter(
      (seg: TimelineSegment) => seg.processor === 'ffmpeg' && seg.source
    )

    for (let i = 0; i < ffmpegSegments.length; i++) {
      const seg = ffmpegSegments[i]
      const outputPath = `${renderedDir}/seg${i + 1}.mp4`

      if (seg.trim && seg.source) {
        const [startStr, endStr] = seg.trim.split('-')
        const startSec = parseFloat(startStr ?? '0')
        const endSec = parseFloat(endStr ?? '0')
        const result = await trimClip(seg.source, startSec, endSec, outputPath)
        if (!result.ok) {
          throw new Error(`Failed to trim segment ${seg.id}: ${result.error}`)
        }
        paths.push(outputPath)
      } else if (seg.source) {
        paths.push(seg.source)
      }
    }

    return paths
  })

  // Step 6: Composite — concat all segments into master
  const masterPath = await step.run('composite', async (): Promise<string> => {
    const masterOutput = `${renderedDir}/master.mp4`
    const result = await concatClips(segmentPaths, masterOutput)
    if (!result.ok) {
      throw new Error(`Failed to concat clips: ${result.error}`)
    }
    return masterOutput
  })

  // Step 7: Audio mix
  const mixedMasterPath = await step.run('audio-mix', async (): Promise<string> => {
    if (!edl.audio.backgroundMusic) {
      return masterPath
    }
    const mixedOutput = `${renderedDir}/master_mixed.mp4`
    const { source: musicSource, volume: musicVolume } = edl.audio.backgroundMusic
    const originalVolume = edl.audio.originalAudio?.volume ?? 1.0
    const result = await mixAudio(
      masterPath,
      musicSource,
      { video: originalVolume, audio: musicVolume },
      mixedOutput
    )
    if (!result.ok) {
      throw new Error(`Failed to mix audio: ${result.error}`)
    }
    return mixedOutput
  })

  // Step 8: Reformat outputs
  const outputs = await step.run('reformat-outputs', async (): Promise<string[]> => {
    const outputPaths: string[] = []
    for (const format of formats) {
      const formatDir = `${outputDir}/${format}`
      await fs.mkdir(formatDir, { recursive: true })
      const outputPath = `${formatDir}/output.mp4`
      const result = await reformat(mixedMasterPath, format, outputPath)
      if (!result.ok) {
        throw new Error(`Failed to reformat to ${format}: ${result.error}`)
      }
      outputPaths.push(outputPath)
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

  return {
    projectName,
    edl,
    masterPath: mixedMasterPath,
    outputs,
    dryRun: false,
  }
}

// ─── Inngest Function ───

export const produceVideo = inngest.createFunction(
  {
    id: 'produce-video',
    name: 'Produce Video',
    triggers: [{ event: 'video/production-requested' }],
  },
  async ({ event, step }) => {
    return produceVideoPipeline(event as PipelineEvent, step as unknown as StepTools)
  }
)
