import { join } from 'node:path'
import { extractAudio } from '../../services/ffmpeg.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'extractAudio',
  description:
    'Extracts the audio track from a video file as a standalone audio file (MP3 or WAV). Use to separate audio before processing, to pass audio to ElevenLabs for analysis, or to create a music-only asset.',
  inputs: [
    {
      name: 'videoPath',
      type: 'asset',
      description: 'Asset name of the source video to extract audio from.',
      required: true,
    },
    {
      name: 'format',
      type: 'string',
      description: 'Output format: "mp3" (default, smaller) or "wav" (uncompressed).',
      required: false,
    },
  ],
  outputs: [
    { name: 'extractedAudio', description: 'Path to the extracted audio file.' },
  ],
  estimatedSeconds: 10,
}

export const execute: ExecuteFn = async (inputs, assets, projectDir) => {
  const videoAsset = inputs.videoPath as string
  const videoPath = assets[videoAsset]
  if (!videoPath) {
    throw new Error(`Asset "${videoAsset}" not found. Available: ${Object.keys(assets).join(', ')}`)
  }

  const format = (inputs.format as 'mp3' | 'wav' | undefined) === 'wav' ? 'wav' : 'mp3'
  const outputPath = join(projectDir, `extracted-audio-${Date.now()}.${format}`)

  const result = await extractAudio(videoPath, outputPath, format)
  if (!result.ok) throw new Error(`extractAudio failed: ${result.error}`)

  return { extractedAudio: outputPath }
}
