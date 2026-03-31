import { join } from 'node:path'
import { mixAudio } from '../../services/ffmpeg.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'addBackgroundMusic',
  description:
    'Mixes a music or audio file under video footage. Use when user asks to add music/soundtrack. ElevenLabs generateMusic output can be passed here.',
  inputs: [
    {
      name: 'videoPath',
      type: 'asset',
      description: 'Asset name of the source video.',
      required: true,
    },
    {
      name: 'audioPath',
      type: 'asset',
      description: 'Asset name of the music or audio file to mix in.',
      required: true,
    },
    {
      name: 'videoVolume',
      type: 'number',
      description: 'Volume multiplier for the original video audio. Defaults to 1.0 (full volume).',
      required: false,
    },
    {
      name: 'musicVolume',
      type: 'number',
      description: 'Volume multiplier for the background music track. Defaults to 0.3.',
      required: false,
    },
  ],
  outputs: [
    { name: 'withMusic', description: 'Path to the video with background music mixed in.' },
  ],
  estimatedSeconds: 15,
}

export const execute: ExecuteFn = async (inputs, assets, projectDir) => {
  const videoAsset = inputs.videoPath as string
  const audioAsset = inputs.audioPath as string

  const videoInput = assets[videoAsset]
  if (!videoInput) {
    throw new Error(
      `Asset "${videoAsset}" not found. Available: ${Object.keys(assets).join(', ')}`
    )
  }

  // audioAsset may be an empty string if music generation was skipped (e.g. quota exceeded).
  // In that case, pass through the video unchanged.
  const audioInput = assets[audioAsset] ?? audioAsset
  if (!audioInput) {
    console.warn('[addBackgroundMusic] No audio input — returning video unchanged')
    return { withMusic: videoInput }
  }

  const videoVolume = inputs.videoVolume !== undefined ? Number(inputs.videoVolume) : 1.0
  const musicVolume = inputs.musicVolume !== undefined ? Number(inputs.musicVolume) : 0.3

  if (!Number.isFinite(videoVolume) || videoVolume < 0) {
    throw new Error(`videoVolume must be a non-negative number, got: ${inputs.videoVolume}`)
  }
  if (!Number.isFinite(musicVolume) || musicVolume < 0) {
    throw new Error(`musicVolume must be a non-negative number, got: ${inputs.musicVolume}`)
  }

  const output = join(projectDir, `with-music-${Date.now()}.mp4`)

  const result = await mixAudio(videoInput, audioInput, { video: videoVolume, audio: musicVolume }, output)
  if (!result.ok) throw new Error(`mixAudio failed: ${result.error}`)

  return { withMusic: output }
}
