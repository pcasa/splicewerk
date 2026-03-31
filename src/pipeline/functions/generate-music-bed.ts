import { join } from 'node:path'
import { copyFile } from 'node:fs/promises'
import { generateMusic } from '../../services/elevenlabs.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'generateMusicBed',
  description:
    'Generates a background music track from a text description using ElevenLabs Music API. Use for ambient beds, driving music, cinematic scores. Then use addBackgroundMusic to layer it under the video. Be specific about energy, genre, and mood.',
  inputs: [
    {
      name: 'prompt',
      type: 'string',
      description:
        'Text description of the music to generate. Include tempo, mood, genre, instrumentation. Example: "High-energy JDM drift scene music, aggressive electronic with heavy bass drops, cinematic tension, 140 BPM".',
      required: true,
    },
    {
      name: 'durationSeconds',
      type: 'number',
      description: 'Duration in seconds. Default: 30. Max: 180.',
      required: false,
    },
  ],
  outputs: [
    { name: 'musicPath', description: 'Path to the generated music MP3 file.' },
  ],
  estimatedSeconds: 20,
}

export const execute: ExecuteFn = async (inputs, _assets, projectDir) => {
  const prompt = inputs.prompt as string
  if (!prompt?.trim()) throw new Error('prompt is required and cannot be empty')

  const duration = Math.max(5, Math.min(180, Number(inputs.durationSeconds ?? 30)))

  const result = await generateMusic(prompt.trim(), duration)

  // ElevenLabs music requires Creator plan (100K credits/month).
  // If quota is exceeded, skip gracefully — pipeline continues without music.
  if (!result.ok) {
    if (result.error.includes('quota_exceeded') || result.error.includes('401')) {
      console.warn(`[generateMusicBed] ElevenLabs quota exceeded — skipping music generation. Upgrade to Creator plan to enable.`)
      return { musicPath: '' }
    }
    throw new Error(`generateMusic failed: ${result.error}`)
  }

  const outputPath = join(projectDir, `music-${Date.now()}.mp3`)
  await copyFile(result.value, outputPath)

  return { musicPath: outputPath }
}
