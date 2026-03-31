import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'transcribeAudio',
  description:
    'Transcribes speech from a video or audio file using NVIDIA NIM Whisper. Returns a text transcript. Run this before addSubtitles.',
  inputs: [
    {
      name: 'videoPath',
      type: 'asset',
      description: 'Asset name of the source video or audio file to transcribe.',
      required: true,
    },
    {
      name: 'language',
      type: 'string',
      description: 'Language code for transcription (default: "en").',
      required: false,
    },
  ],
  outputs: [
    { name: 'transcriptPath', description: 'Path to .txt file containing the transcription.' },
  ],
  estimatedSeconds: 30,
}

export const execute: ExecuteFn = async (inputs, assets, projectDir) => {
  const videoAsset = inputs.videoPath as string
  const videoPath = assets[videoAsset]
  if (!videoPath) {
    throw new Error(
      `Asset "${videoAsset}" not found. Available: ${Object.keys(assets).join(', ')}`
    )
  }

  const language = (inputs.language as string | undefined) ?? 'en'

  const apiKey = process.env.NVIDIA_API_KEY
  if (!apiKey) {
    throw new Error('NVIDIA_API_KEY is not set')
  }

  console.log(`[transcribeAudio] Reading file: ${videoPath}`)
  const fileBuffer = await fs.readFile(videoPath)

  const ext = path.extname(videoPath).toLowerCase() || '.mp4'
  const mimeType = ext === '.mp3' ? 'audio/mpeg'
    : ext === '.wav' ? 'audio/wav'
    : ext === '.m4a' ? 'audio/mp4'
    : 'video/mp4'

  const formData = new FormData()
  const blob = new Blob([fileBuffer], { type: mimeType })
  formData.append('file', blob, `input${ext}`)
  formData.append('model', 'nvidia/canary-1b')
  formData.append('language', language)
  formData.append('response_format', 'text')

  console.log(`[transcribeAudio] Sending to NVIDIA NIM Whisper (model: nvidia/canary-1b)`)

  let response: Response
  try {
    response = await fetch('https://integrate.api.nvidia.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Network error calling NVIDIA NIM: ${message}`)
  }

  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = await response.json() as { detail?: string; message?: string }
      detail = body.detail ?? body.message ?? detail
    } catch { /* ignore parse errors */ }
    throw new Error(`NVIDIA NIM transcription failed: HTTP ${response.status} — ${detail}`)
  }

  const transcript = await response.text()

  const transcriptPath = path.join(projectDir, 'pipeline-transcript.txt')
  await fs.writeFile(transcriptPath, transcript.trim(), 'utf-8')

  console.log(`[transcribeAudio] Transcript saved to: ${transcriptPath}`)
  return { transcriptPath }
}
