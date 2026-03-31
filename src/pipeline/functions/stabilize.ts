import { join } from 'node:path'
import { stabilizeClip } from '../../services/ffmpeg.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'stabilizeClip',
  description: 'Removes camera shake from shaky phone/handheld footage using two-pass vidstab. Always run this on raw phone footage before any other processing.',
  inputs: [
    { name: 'videoPath', type: 'asset', description: 'Path to the raw input video file', required: true },
    { name: 'shakiness', type: 'number', description: 'Shakiness detection sensitivity 1-10. Use 10 for phone walking footage.', required: false },
    { name: 'smoothing', type: 'number', description: 'Smoothing radius in frames. Use 30 for heavy stabilization.', required: false },
  ],
  outputs: [
    { name: 'stabilized', description: 'Path to stabilized video file' },
  ],
  estimatedSeconds: 90,
}

export const execute: ExecuteFn = async (inputs, assets, projectDir) => {
  const videoAsset = inputs.videoPath as string
  const videoPath = assets[videoAsset] ?? videoAsset
  const output = join(projectDir, 'pipeline-stabilized.mp4')
  const result = await stabilizeClip(
    videoPath,
    output,
    {
      shakiness: (inputs.shakiness as number | undefined) ?? 10,
      smoothing: (inputs.smoothing as number | undefined) ?? 30,
    }
  )
  if (!result.ok) throw new Error(`stabilizeClip failed: ${result.error}`)
  return { stabilized: output }
}
