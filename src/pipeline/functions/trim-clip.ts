import { join } from 'node:path'
import { trimClip } from '../../services/ffmpeg.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'trimClip',
  description:
    'Cuts a video clip to a specific time range. Use when user specifies start/end times like "use 0:15 to 1:30".',
  inputs: [
    {
      name: 'videoPath',
      type: 'asset',
      description: 'Asset name of the source video to trim.',
      required: true,
    },
    {
      name: 'startSec',
      type: 'number',
      description: 'Start time in seconds.',
      required: true,
    },
    {
      name: 'endSec',
      type: 'number',
      description: 'End time in seconds.',
      required: true,
    },
  ],
  outputs: [
    { name: 'trimmed', description: 'Path to the trimmed video.' },
  ],
  estimatedSeconds: 10,
}

export const execute: ExecuteFn = async (inputs, assets, projectDir) => {
  const videoAsset = inputs.videoPath as string
  const input = assets[videoAsset]
  if (!input) {
    throw new Error(
      `Asset "${videoAsset}" not found. Available: ${Object.keys(assets).join(', ')}`
    )
  }

  const startSec = Number(inputs.startSec)
  const endSec = Number(inputs.endSec)

  if (!Number.isFinite(startSec) || startSec < 0) {
    throw new Error(`startSec must be a non-negative number, got: ${inputs.startSec}`)
  }
  if (!Number.isFinite(endSec) || endSec <= startSec) {
    throw new Error(`endSec must be greater than startSec. Got startSec=${startSec}, endSec=${endSec}`)
  }

  const output = join(projectDir, `trimmed-${Date.now()}.mp4`)

  const result = await trimClip(input, startSec, endSec, output)
  if (!result.ok) throw new Error(`trimClip failed: ${result.error}`)

  return { trimmed: output }
}
