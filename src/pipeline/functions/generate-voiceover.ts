import { join } from 'node:path'
import { copyFile } from 'node:fs/promises'
import { generateTTS } from '../../services/elevenlabs.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'generateVoiceover',
  description:
    'Generates a voiceover narration audio file from text using ElevenLabs TTS. Use when the user wants spoken narration over the video. Returns an MP3 audio file that can be mixed with addBackgroundMusic.',
  inputs: [
    {
      name: 'text',
      type: 'string',
      description: 'The narration text to convert to speech.',
      required: true,
    },
    {
      name: 'voiceId',
      type: 'string',
      description:
        'ElevenLabs voice ID. Optional — defaults to Rachel (21m00Tcm4TlvDq8ikWAM). Find voice IDs at elevenlabs.io/voices.',
      required: false,
    },
  ],
  outputs: [
    { name: 'voiceoverPath', description: 'Path to the generated voiceover MP3 file.' },
  ],
  estimatedSeconds: 15,
}

export const execute: ExecuteFn = async (inputs, _assets, projectDir) => {
  const text = inputs.text as string
  if (!text?.trim()) throw new Error('text input is required and cannot be empty')

  const voiceId = inputs.voiceId as string | undefined

  const result = await generateTTS(text.trim(), voiceId)
  if (!result.ok) throw new Error(`generateTTS failed: ${result.error}`)

  // Copy to projectDir so all pipeline assets live in one place
  const outputPath = join(projectDir, `voiceover-${Date.now()}.mp3`)
  await copyFile(result.value, outputPath)

  return { voiceoverPath: outputPath }
}
