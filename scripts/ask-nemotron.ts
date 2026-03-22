/**
 * ask-nemotron.ts — Consult Nemotron on any pipeline question
 *
 * Usage:
 *   pnpm nemotron "why does our audio sound degraded in the final output?"
 *   pnpm nemotron "how should we handle multi-format output for instagram vs youtube?"
 */
import 'dotenv/config'
import { callLLM } from '../src/services/llm.js'

const NEMOTRON_MODEL = 'nvidia/llama-3.3-nemotron-super-49b-v1'
const NIM_BASE_URL   = 'https://integrate.api.nvidia.com/v1'

const SYSTEM_PROMPT = `You are a video production pipeline architect advising the Splicewerk team.
The team is building an AI-driven video production platform with this core pipeline:
- NVIDIA NIM (Nemotron) — generates creative prompts and provides pipeline advice
- Runway Gen-4 Turbo — AI image-to-video for cinematic visual effects
- Shotstack — cloud video assembly (video + audio + compositing)
- sharp + ffmpeg — local image processing and text overlay
- Inngest — orchestrates the pipeline as observable step functions

Current project: Autobahn Syndicate brand logo reveal video.
Brand: German automotive performance, colors #E02828 red / #F46E2C orange, font Montserrat.

Give concrete, actionable recommendations. Be direct and specific about pipeline changes.`

async function main() {
  const apiKey = process.env.NVIDIA_API_KEY
  if (!apiKey) { console.error('NVIDIA_API_KEY not set'); process.exit(1) }

  const question = process.argv.slice(2).join(' ')
  if (!question) {
    console.error('Usage: pnpm nemotron "<your question>"')
    process.exit(1)
  }

  console.log(`\n🤖 Asking Nemotron: "${question}"\n${'─'.repeat(60)}\n`)

  const result = await callLLM(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: question },
    ],
    { model: NEMOTRON_MODEL, temperature: 0.3, maxTokens: 1000 },
    NIM_BASE_URL,
    `Bearer ${apiKey}`
  )

  if (result.ok) console.log(result.value)
  else { console.error('Nemotron failed:', result.error); process.exit(1) }
}

main()
