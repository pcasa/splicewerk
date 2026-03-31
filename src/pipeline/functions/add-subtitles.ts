import { join } from 'node:path'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'addSubtitles',
  description:
    'Burns subtitle text onto a video. Requires a transcript file (plain text). Displays text as centered bottom captions. Run transcribeAudio first to get the transcript.',
  inputs: [
    {
      name: 'videoPath',
      type: 'asset',
      description: 'Asset name of the source video to add subtitles to.',
      required: true,
    },
    {
      name: 'transcriptPath',
      type: 'asset',
      description: 'Asset name of the .txt transcript file from transcribeAudio.',
      required: true,
    },
    {
      name: 'fontSize',
      type: 'number',
      description: 'Font size for subtitles. Default: 36.',
      required: false,
    },
    {
      name: 'fontColor',
      type: 'string',
      description: 'Font color hex (no #). Default: white.',
      required: false,
    },
  ],
  outputs: [
    { name: 'subtitled', description: 'Path to video with burned-in subtitles.' },
  ],
  estimatedSeconds: 40,
}

export const execute: ExecuteFn = async (inputs, assets, projectDir) => {
  const videoAsset = inputs.videoPath as string
  const videoPath = assets[videoAsset]
  if (!videoPath) {
    throw new Error(`Asset "${videoAsset}" not found. Available: ${Object.keys(assets).join(', ')}`)
  }

  const transcriptAsset = inputs.transcriptPath as string
  const transcriptPath = assets[transcriptAsset]
  if (!transcriptPath) {
    throw new Error(`Asset "${transcriptAsset}" not found. Available: ${Object.keys(assets).join(', ')}`)
  }

  const fontSize = Number(inputs.fontSize ?? 36)
  const fontColor = (inputs.fontColor as string | undefined) ?? 'white'

  const transcriptText = (await fs.readFile(transcriptPath, 'utf-8')).trim()
  if (!transcriptText) throw new Error('Transcript file is empty')

  // Write as a basic SRT with the full text shown for the video duration
  const srtPath = join(projectDir, 'subtitles.srt')
  const srt = `1\n00:00:00,000 --> 99:59:59,999\n${transcriptText}\n`
  await fs.writeFile(srtPath, srt, 'utf-8')

  const output = join(projectDir, `subtitled-${Date.now()}.mp4`)

  // Escape path for ffmpeg drawtext/subtitles filter (colons and backslashes)
  const escapedSrt = srtPath.replace(/\\/g, '\\\\').replace(/:/g, '\\:')

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', videoPath,
      '-vf', `subtitles=${escapedSrt}:force_style='FontSize=${fontSize},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2'`,
      '-c:a', 'copy',
      '-y', output,
    ])
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg addSubtitles exited with code ${code}`))
    })
  })

  return { subtitled: output }
}
