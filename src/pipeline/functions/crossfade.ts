import { join } from 'node:path'
import { crossfade as crossfadeClips } from '../../services/ffmpeg.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'crossfade',
  description:
    'Creates a smooth fade transition between two video clips. Use instead of hard cuts for more cinematic assembly.',
  inputs: [
    {
      name: 'clipAPath',
      type: 'asset',
      description: 'Asset name of the first (outgoing) clip.',
      required: true,
    },
    {
      name: 'clipBPath',
      type: 'asset',
      description: 'Asset name of the second (incoming) clip.',
      required: true,
    },
    {
      name: 'durationSec',
      type: 'number',
      description: 'Duration of the crossfade transition in seconds. Defaults to 0.5.',
      required: false,
    },
  ],
  outputs: [
    { name: 'crossfaded', description: 'Path to the video with the crossfade transition applied.' },
  ],
  estimatedSeconds: 10,
}

export const execute: ExecuteFn = async (inputs, assets, projectDir) => {
  const clipAAsset = inputs.clipAPath as string
  const clipBAsset = inputs.clipBPath as string

  const clipA = assets[clipAAsset]
  if (!clipA) {
    throw new Error(
      `Asset "${clipAAsset}" not found. Available: ${Object.keys(assets).join(', ')}`
    )
  }

  const clipB = assets[clipBAsset]
  if (!clipB) {
    throw new Error(
      `Asset "${clipBAsset}" not found. Available: ${Object.keys(assets).join(', ')}`
    )
  }

  const durationSec = inputs.durationSec !== undefined ? Number(inputs.durationSec) : 0.5
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`durationSec must be a positive number, got: ${inputs.durationSec}`)
  }

  const output = join(projectDir, `crossfaded-${Date.now()}.mp4`)

  const result = await crossfadeClips(clipA, clipB, durationSec, output)
  if (!result.ok) throw new Error(`crossfade failed: ${result.error}`)

  return { crossfaded: output }
}
