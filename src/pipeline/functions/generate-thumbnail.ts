import { join } from 'node:path'
import { extractThumbnail } from '../../services/ffmpeg.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'generateThumbnail',
  description:
    'Extracts a high-quality thumbnail frame from a video at a specified timestamp. Use to create YouTube thumbnails, preview images, or poster frames from finished video.',
  inputs: [
    {
      name: 'videoPath',
      type: 'asset',
      description: 'Asset name of the source video.',
      required: true,
    },
    {
      name: 'timestampSec',
      type: 'number',
      description: 'Timestamp in seconds to extract the frame from. Default: 1 (near beginning).',
      required: false,
    },
  ],
  outputs: [
    { name: 'thumbnail', description: 'Path to the extracted thumbnail JPG image.' },
  ],
  estimatedSeconds: 5,
}

export const execute: ExecuteFn = async (inputs, assets, projectDir) => {
  const videoAsset = inputs.videoPath as string
  const videoPath = assets[videoAsset]
  if (!videoPath) {
    throw new Error(`Asset "${videoAsset}" not found. Available: ${Object.keys(assets).join(', ')}`)
  }

  const timestamp = inputs.timestampSec !== undefined ? Number(inputs.timestampSec) : 1
  const outputPath = join(projectDir, `thumbnail-${Date.now()}.jpg`)

  const result = await extractThumbnail(videoPath, outputPath, timestamp)
  if (!result.ok) throw new Error(`extractThumbnail failed: ${result.error}`)

  return { thumbnail: outputPath }
}
