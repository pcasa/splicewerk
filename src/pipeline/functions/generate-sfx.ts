import { join } from 'node:path'
import { copyFile } from 'node:fs/promises'
import { generateSFX } from '../../services/elevenlabs.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'generateSFX',
  description:
    'Generates a sound effect audio file from a text description using ElevenLabs. Use for one-shot sounds like engine revs, tire squeals, crowd cheers, gear shifts. Be specific: "Deep V8 idle reverberating in underground parking garage" works better than "car sound".',
  inputs: [
    {
      name: 'prompt',
      type: 'string',
      description:
        'Descriptive text for the sound effect. Include material + environment for best results. Example: "Tire screech on wet asphalt with rain ambience".',
      required: true,
    },
    {
      name: 'durationSeconds',
      type: 'number',
      description: 'Duration in seconds (1-22). Default: 3.',
      required: false,
    },
  ],
  outputs: [
    { name: 'sfxPath', description: 'Path to the generated sound effect MP3 file.' },
  ],
  estimatedSeconds: 10,
}

export const execute: ExecuteFn = async (inputs, _assets, projectDir) => {
  const prompt = inputs.prompt as string
  if (!prompt?.trim()) throw new Error('prompt is required and cannot be empty')

  const duration = Math.max(1, Math.min(22, Number(inputs.durationSeconds ?? 3)))

  const result = await generateSFX(prompt.trim(), duration)
  if (!result.ok) throw new Error(`generateSFX failed: ${result.error}`)

  const outputPath = join(projectDir, `sfx-${Date.now()}.mp3`)
  await copyFile(result.value, outputPath)

  return { sfxPath: outputPath }
}
