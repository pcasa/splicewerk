import { join } from 'node:path'
import { stabilizeClip } from '../../services/ffmpeg.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'stabilizeClip',
  description:
    'Removes camera shake from handheld/phone footage using two-pass vidstab with bicubic interpolation and dynamic zoom cropping. ' +
    'Good for mild-to-moderate shake (stationary filming, slow walking shots). ' +
    'For severely shaky footage (fast motion, running, car interior bouncing) prefer runwayEditVideo — ' +
    'Runway produces cinematic results where ffmpeg stabilization would degrade quality. ' +
    'Default shakiness=6 and smoothing=10 work well for most phone footage. ' +
    'Keep smoothing ≤15 — higher values force large frame shifts that hurt quality.',
  inputs: [
    { name: 'videoPath', type: 'asset', description: 'Asset name of the source video to stabilize.', required: true },
    { name: 'shakiness', type: 'number', description: 'Motion detection sensitivity 1-10. Default: 6. Use 7-8 for very shaky footage. Avoid 9-10 — causes over-detection and quality loss.', required: false },
    { name: 'smoothing', type: 'number', description: 'Smoothing radius in frames. Default: 10. Keep ≤15. Higher values require larger frame shifts that degrade quality.', required: false },
    { name: 'maxZoom', type: 'number', description: 'Max zoom crop % to hide stabilization borders (1-15). Default: 8. Increase to 12 if black edges are visible.', required: false },
  ],
  outputs: [
    { name: 'stabilized', description: 'Path to the stabilized video file.' },
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
      shakiness: (inputs.shakiness as number | undefined) ?? 6,
      smoothing: (inputs.smoothing as number | undefined) ?? 10,
      maxZoom: (inputs.maxZoom as number | undefined) ?? 8,
    }
  )
  if (!result.ok) throw new Error(`stabilizeClip failed: ${result.error}`)
  return { stabilized: output }
}
