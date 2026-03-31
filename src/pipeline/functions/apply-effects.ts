import { join } from 'node:path'
import { applyEffects } from '../../services/ffmpeg.js'
import type { EffectsOptions } from '../../services/ffmpeg.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

type GradeValue = 'teal-orange' | 'cool' | 'warm' | 'none'

const VALID_GRADES: GradeValue[] = ['teal-orange', 'cool', 'warm', 'none']

function resolveGrade(raw: unknown): GradeValue {
  if (typeof raw === 'string' && (VALID_GRADES as string[]).includes(raw)) {
    return raw as GradeValue
  }
  return 'teal-orange'
}

export const manifest: FunctionManifest = {
  name: 'applyEffects',
  description:
    'Applies cinematic color grading and visual effects to footage. "teal-orange" is the classic automotive/action movie look. Use to make raw footage look cinematic.',
  inputs: [
    {
      name: 'videoPath',
      type: 'asset',
      description: 'Asset name of the source video to grade.',
      required: true,
    },
    {
      name: 'grade',
      type: 'string',
      description:
        'Colour grade preset. One of: "teal-orange" (default), "cool", "warm", "none".',
      required: false,
    },
    {
      name: 'contrast',
      type: 'number',
      description: 'Contrast boost multiplier. 1.0 = no change. Defaults to 1.15.',
      required: false,
    },
    {
      name: 'glow',
      type: 'number',
      description: 'Glow/unsharp intensity from 0 to 1. Defaults to 0.25.',
      required: false,
    },
  ],
  outputs: [
    { name: 'graded', description: 'Path to the color-graded video.' },
  ],
  estimatedSeconds: 20,
}

export const execute: ExecuteFn = async (inputs, assets, projectDir) => {
  const videoAsset = inputs.videoPath as string
  const inputPath = assets[videoAsset]
  if (!inputPath) {
    throw new Error(
      `Asset "${videoAsset}" not found. Available: ${Object.keys(assets).join(', ')}`
    )
  }

  const grade = resolveGrade(inputs.grade)

  const contrast = inputs.contrast !== undefined ? Number(inputs.contrast) : 1.15
  if (!Number.isFinite(contrast) || contrast <= 0) {
    throw new Error(`contrast must be a positive number, got: ${inputs.contrast}`)
  }

  const glow = inputs.glow !== undefined ? Number(inputs.glow) : 0.25
  if (!Number.isFinite(glow) || glow < 0 || glow > 1) {
    throw new Error(`glow must be between 0 and 1, got: ${inputs.glow}`)
  }

  const options: EffectsOptions = { grade, contrast, glow }
  const outputPath = join(projectDir, `graded-${Date.now()}.mp4`)

  const result = await applyEffects(inputPath, outputPath, options)
  if (!result.ok) throw new Error(`applyEffects failed: ${result.error}`)

  return { graded: outputPath }
}
