import { join } from 'node:path'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { trimClip, getVideoDuration } from '../../services/ffmpeg.js'
import { callLLM } from '../../services/llm.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'extractClipHighlight',
  description:
    'Uses AI to identify the best N seconds in a video clip and extracts that segment. Useful for auto-selecting the most exciting moment from raw footage — burnouts, drift entries, launch moments. The AI uses the user intent and video duration to pick the best window.',
  inputs: [
    {
      name: 'videoPath',
      type: 'asset',
      description: 'Asset name of the source video to find highlights in.',
      required: true,
    },
    {
      name: 'highlightDuration',
      type: 'number',
      description: 'Length of highlight to extract in seconds. Default: 10.',
      required: false,
    },
    {
      name: 'context',
      type: 'string',
      description:
        'Describe what kind of moment to look for. Example: "the most aggressive drift entry", "the launch from 0 to speed", "the cleanest corner exit".',
      required: false,
    },
  ],
  outputs: [
    { name: 'highlight', description: 'Path to the extracted highlight clip.' },
    { name: 'highlightStartSec', description: 'Start timestamp (seconds) of the extracted segment.' },
    { name: 'highlightEndSec', description: 'End timestamp (seconds) of the extracted segment.' },
  ],
  estimatedSeconds: 30,
}

export const execute: ExecuteFn = async (inputs, assets, projectDir) => {
  const videoAsset = inputs.videoPath as string
  const videoPath = assets[videoAsset]
  if (!videoPath) {
    throw new Error(`Asset "${videoAsset}" not found. Available: ${Object.keys(assets).join(', ')}`)
  }

  const desiredDuration = Math.max(3, Number(inputs.highlightDuration ?? 10))
  const context = (inputs.context as string | undefined) ?? 'the most exciting and visually dynamic moment'

  const durationResult = await getVideoDuration(videoPath)
  if (!durationResult.ok) throw new Error(`Could not get video duration: ${durationResult.error}`)
  const totalDuration = durationResult.value

  if (desiredDuration >= totalDuration) {
    // Entire clip is the highlight
    const output = join(projectDir, `highlight-full-${Date.now()}.mp4`)
    await pipeline(createReadStream(videoPath), createWriteStream(output))
    return { highlight: output, highlightStartSec: '0', highlightEndSec: String(totalDuration) }
  }

  // Ask AI to pick the best window based on context
  const userPrompt = `You are analyzing a ${totalDuration.toFixed(1)}-second video clip for an automotive content creator.

The clip is raw driving footage. The user wants to extract: ${context}

Given that the clip is ${totalDuration.toFixed(1)} seconds long and we want to extract ${desiredDuration} seconds:

Return ONLY a JSON object with no explanation:
{"startSec": <number>, "reasoning": "<one sentence>"}

Rules:
- startSec must be >= 0 and <= ${(totalDuration - desiredDuration).toFixed(1)}
- Assume automotive content: launches tend to be at the start, peaks at 30-50% through, sustained action in the middle third
- When in doubt, favor 20-40% into the clip for most automotive highlights`

  // Default: 30% into the clip
  let startSec = Math.max(0, (totalDuration - desiredDuration) * 0.3)

  const llmResult = await callLLM([
    { role: 'system' as const, content: 'You are a video editor assistant. Always respond with valid JSON only.' },
    { role: 'user' as const, content: userPrompt },
  ])
  if (llmResult.ok) {
    try {
      const cleaned = llmResult.value.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      const parsed = JSON.parse(cleaned) as { startSec: number }
      const candidate = Number(parsed.startSec)
      if (Number.isFinite(candidate) && candidate >= 0 && candidate <= totalDuration - desiredDuration) {
        startSec = candidate
      }
    } catch {
      // keep default startSec
    }
  }

  const endSec = startSec + desiredDuration
  const output = join(projectDir, `highlight-${Date.now()}.mp4`)
  const trimResult = await trimClip(videoPath, startSec, endSec, output)
  if (!trimResult.ok) throw new Error(`trimClip failed: ${trimResult.error}`)

  return {
    highlight: output,
    highlightStartSec: String(startSec.toFixed(2)),
    highlightEndSec: String(endSec.toFixed(2)),
  }
}
