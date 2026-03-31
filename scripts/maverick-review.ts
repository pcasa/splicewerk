import 'dotenv/config'
import { callLLM } from '../src/services/llm.js'

const systemPrompt = `You are a senior AI systems expert and prompt engineer advising on an AI-driven video production pipeline. Be direct and specific. Focus on practical improvements.`

const userPrompt = `## Project: Splicewerk — POC Stage

Splicewerk is an AI-driven video production pipeline for Autobahn Syndicate, a German automotive performance brand. This is a proof-of-concept. We are NOT optimizing for scale or cost yet — local file storage and simple solutions are intentional.

Core AI-to-AI concept: NVIDIA NIM generates creative prompts → Runway Gen-4 executes them as cinematic video.

Tech stack: Node.js 24, TypeScript, Inngest, NVIDIA NIM, Runway Gen-4, Shotstack, ffmpeg, Supabase, Next.js 14.

---

## Feature we are adding (SPLICE-003)

After every pipeline run, extract 5 evenly-sampled frames from the final video, send them to a vision model (meta/llama-4-maverick-17b-128e-instruct) along with the user's original description, and store the result as a local JSON file. Advisory only — no auto re-run.

Storage is intentionally local JSON files (POC). No scale concerns right now.

The main open question before building: what should the system prompt and user prompt look like when we call the vision model for validation? We need it to compare the video frames against the user's description and return structured feedback.

---

## Our existing prompts — please review these too

### Prompt 1: EDL Generation (generateEDL)
This prompt asks the LLM to generate a JSON Edit Decision List from the user's description and available video assets.

SYSTEM:
"""
You are a professional video editor AI that generates Edit Decision Lists (EDLs) in JSON format.

[EDL JSON Schema with full type definitions for project, timeline segments, audio, thumbnail]

Available Assets: [list of filenames with type/duration]

CRITICAL RULES:
1. Every timeline segment MUST have a "processor" field. Use:
   - "ffmpeg" for video clips, video trimming, stabilization, or color grading
   - "runway" for images (image-to-video), text title cards, or AI-generated scenes
   - "elevenlabs" for audio/SFX generation only
2. Use EXACT filenames from the Available Assets list above. Do NOT invent or guess filenames.
3. For Runway image segments, "durationSeconds" must be 5 or 10 (round to nearest).
4. For ffmpeg video segments with "operation": "stabilize", include "processor": "ffmpeg".
5. Output ONLY valid JSON. No markdown fences, no explanations. Must be parseable by JSON.parse() directly.
"""

USER: [the user's raw description, e.g. "Use clip1.mov from 0:15 to 0:47, then clip2.mov..."]

---

### Prompt 2: Cinematic Prompt Generation — Vision Path (generateCinematicPrompt)
This is the core AI-to-AI prompt. The vision model analyzes the brand logo image and writes a Runway Gen-4 prompt.

SYSTEM:
"""
You are a creative director specializing in cinematic brand video production.
Write a Runway Gen-4 image-to-video prompt for a logo reveal on a pure black background.
The prompt must describe: cinematic effects (light rays, sparks, shimmer, embers, fog), color palette, camera movement, and overall feel.
Static locked-off camera — no zoom, no push-in. Wide shot that holds the full logo in frame.
Keep it under 900 characters. Output ONLY the prompt text — no explanation, no preamble.
"""

USER (multimodal — image + text):
"""
[base64 logo image]
This is the logo for {brandName} ({industry}).
Analyze the logo's visual style, colors, and composition, then write a Runway Gen-4 prompt
that animates it with spectacular cinematic effects matching the brand's identity.
"""

---

### Prompt 3: Cinematic Prompt Generation — Text Fallback Path
Used when the logo image is not available or vision call fails.

SYSTEM: [same as above]

USER:
"""
Brand: {brandName}
Industry: {industry}
Brand Colors: {primary}, {secondary}, {accent}
Tagline: {tagline}
Mood: cinematic, dramatic, high-budget
Write a Runway Gen-4 prompt that animates this logo on a pure black background with spectacular cinematic effects.
"""

---

## Questions for you

1. For SPLICE-003 validation: what should the system prompt and user message look like when sending 5 video frames + the user's original description to the vision model? We want structured output matching this type:
   type VideoValidation = {
     verdict: 'pass' | 'needs-work'
     summary: string
     issues: string[]
     promptFix?: string
     runwayPromptFix?: string
   }

2. For the EDL generation prompt (Prompt 1): any improvements to make the output more reliable or the instructions clearer?

3. For the cinematic prompt (Prompts 2 & 3): any improvements to get better Runway Gen-4 outputs for automotive/performance brand content?

Be specific — show actual revised prompt text where you have improvements to suggest.`

async function main() {
  const apiKey = process.env.NVIDIA_API_KEY
  if (!apiKey) { console.error('NVIDIA_API_KEY not set'); process.exit(1) }

  console.log('Asking Maverick to review our prompts...\n' + '─'.repeat(60) + '\n')

  const result = await callLLM(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { model: 'meta/llama-4-maverick-17b-128e-instruct', temperature: 0.7, maxTokens: 3000 },
    'https://integrate.api.nvidia.com/v1',
    `Bearer ${apiKey}`
  )

  if (result.ok) console.log(result.value)
  else { console.error('Failed:', result.error); process.exit(1) }
}

main()
