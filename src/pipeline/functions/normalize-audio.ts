import { join } from 'node:path'
import { normalizeAudio } from '../../services/ffmpeg.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'normalizeAudio',
  description:
    'Normalizes audio loudness to -16 LUFS (streaming standard) using FFmpeg loudnorm. Use before final export to ensure consistent volume across clips, or after mixing to hit broadcast/YouTube loudness targets.',
  inputs: [
    {
      name: 'audioPath',
      type: 'asset',
      description: 'Asset name of the audio or video file to normalize.',
      required: true,
    },
  ],
  outputs: [
    { name: 'normalizedAudio', description: 'Path to the normalized audio file.' },
  ],
  estimatedSeconds: 15,
}

export const execute: ExecuteFn = async (inputs, assets, projectDir) => {
  const audioAsset = inputs.audioPath as string
  const audioPath = assets[audioAsset]
  if (!audioPath) {
    throw new Error(`Asset "${audioAsset}" not found. Available: ${Object.keys(assets).join(', ')}`)
  }

  const ext = audioPath.toLowerCase().endsWith('.wav') ? 'wav' : 'mp3'
  const outputPath = join(projectDir, `normalized-audio-${Date.now()}.${ext}`)

  const result = await normalizeAudio(audioPath, outputPath)
  if (!result.ok) throw new Error(`normalizeAudio failed: ${result.error}`)

  return { normalizedAudio: outputPath }
}
