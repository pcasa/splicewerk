import type { EDL, AssetManifest, ProcessingStep } from './types.js'
import { getFormatPreset } from '../services/ffmpeg.js'

// ─── Translation Result ───

export interface TranslationResult {
  steps: ProcessingStep[]
  estimatedDurationMs: number
  estimatedCostUSD: number
}

export function translateEDL(edl: EDL, manifest: AssetManifest, requestedFormats?: string[]): TranslationResult {
  void manifest // manifest is available for future use (asset validation etc.)
  const steps: ProcessingStep[] = []

  // ─── Per-segment steps ───
  for (const segment of edl.timeline) {
    let stepType: ProcessingStep['type']
    let estimatedDuration: number
    let estimatedCost: number

    switch (segment.processor) {
      case 'runway':
        stepType = 'runway'
        estimatedDuration = 60000
        estimatedCost = 0.05
        break
      case 'elevenlabs':
        stepType = 'elevenlabs'
        estimatedDuration = 5000
        estimatedCost = 0.01
        break
      case 'ffmpeg':
      default:
        stepType = 'ffmpeg'
        estimatedDuration = 2000
        estimatedCost = 0
        break
    }

    // Determine input
    let input: string
    if (segment.source) {
      input = segment.source
    } else if (segment.sources && segment.sources.length > 0) {
      input = segment.sources[0].source
    } else {
      input = ''
    }

    // Determine output extension
    const outputExt = segment.processor === 'elevenlabs' ? '.mp3' : '.mp4'
    const output = `rendered/${segment.id}${outputExt}`

    // Build params from relevant segment fields
    const params: Record<string, unknown> = {}
    if (segment.operation !== undefined) params['operation'] = segment.operation
    if (segment.prompt !== undefined) params['prompt'] = segment.prompt
    if (segment.trim !== undefined) params['trim'] = segment.trim
    if (segment.durationSeconds !== undefined) params['durationSeconds'] = segment.durationSeconds
    if (segment.textOverlay !== undefined) params['textOverlay'] = segment.textOverlay

    steps.push({
      id: `step_${segment.id}`,
      type: stepType,
      segmentId: segment.id,
      input,
      output,
      params,
      estimatedDuration,
      estimatedCost,
    })
  }

  // ─── Composite step ───
  const segmentOutputs = steps.map(s => s.output as string)
  steps.push({
    id: 'step_composite',
    type: 'ffmpeg',
    input: segmentOutputs,
    output: 'rendered/master.mp4',
    params: { operation: 'concat' },
    estimatedDuration: 2000,
    estimatedCost: 0,
  })

  // ─── Audio-mix step (if background music exists) ───
  let finalMasterOutput = 'rendered/master.mp4'
  if (edl.audio.backgroundMusic) {
    const musicSource = edl.audio.backgroundMusic.source
    const videoVolume = edl.audio.originalAudio?.volume ?? 1.0
    const audioVolume = edl.audio.backgroundMusic.volume

    steps.push({
      id: 'step_audio_mix',
      type: 'ffmpeg',
      input: ['rendered/master.mp4', musicSource],
      output: 'rendered/master_mixed.mp4',
      params: {
        volumes: {
          video: videoVolume,
          audio: audioVolume,
        },
      },
      estimatedDuration: 2000,
      estimatedCost: 0,
    })

    finalMasterOutput = 'rendered/master_mixed.mp4'
  }

  // ─── Reformat steps ───
  const formats = requestedFormats ?? edl.project.outputFormats
  for (const formatName of formats) {
    const preset = getFormatPreset(formatName)
    const params: Record<string, unknown> = preset
      ? { ...preset }
      : { formatName }

    steps.push({
      id: `step_reformat_${formatName}`,
      type: 'reformat',
      input: finalMasterOutput,
      output: `rendered/${formatName}/output.mp4`,
      params,
      estimatedDuration: 2000,
      estimatedCost: 0,
    })
  }

  // ─── Thumbnail step ───
  steps.push({
    id: 'step_thumbnail',
    type: 'sharp',
    input: 'rendered/master.mp4',
    output: 'rendered/thumbnail/thumb.jpg',
    params: { ...edl.thumbnail },
    estimatedDuration: 1000,
    estimatedCost: 0,
  })

  // ─── Totals ───
  const estimatedDurationMs = steps.reduce((acc, s) => acc + (s.estimatedDuration ?? 0), 0)
  const estimatedCostUSD = steps.reduce((acc, s) => acc + (s.estimatedCost ?? 0), 0)

  return { steps, estimatedDurationMs, estimatedCostUSD }
}
