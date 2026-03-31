import { join } from 'node:path'
import { addFade } from '../../services/ffmpeg.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'addFade',
  description: 'Adds a fade-in at the start and fade-out at the end of a video clip. Apply to the stabilized main footage before concatenation.',
  inputs: [
    { name: 'videoPath', type: 'asset', description: 'Path to the input video to add fades to', required: true },
    { name: 'fadeInSec', type: 'number', description: 'Fade-in duration in seconds. Default: 1', required: false },
    { name: 'fadeOutSec', type: 'number', description: 'Fade-out duration in seconds. Default: 1', required: false },
  ],
  outputs: [
    { name: 'faded', description: 'Path to video with fades applied' },
  ],
  estimatedSeconds: 15,
}

export const execute: ExecuteFn = async (inputs, assets, projectDir) => {
  const videoAsset = inputs.videoPath as string
  const videoPath = assets[videoAsset] ?? videoAsset
  const output = join(projectDir, 'pipeline-faded.mp4')
  const result = await addFade(
    videoPath,
    output,
    (inputs.fadeInSec as number | undefined) ?? 1,
    (inputs.fadeOutSec as number | undefined) ?? 1
  )
  if (!result.ok) throw new Error(`addFade failed: ${result.error}`)
  return { faded: output }
}
