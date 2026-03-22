import 'dotenv/config'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { serve } from 'inngest/node'
import { inngest } from './inngest/client.js'
import { produceVideo } from './inngest/functions/produce-video.js'
import { logoReveal } from './inngest/functions/logo-reveal.js'
import { callLLM } from './services/llm.js'

const handler = serve({ client: inngest, functions: [produceVideo, logoReveal] })
const PORT      = Number(process.env.PORT ?? 3000)
const INNGEST   = 'http://localhost:8288'
const NIM_URL   = 'https://integrate.api.nvidia.com/v1'
const NEMOTRON  = 'nvidia/llama-3.3-nemotron-super-49b-v1'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DASHBOARD = path.join(__dirname, 'ui', 'dashboard.html')

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')) } catch { resolve({}) } })
    req.on('error', reject)
  })
}

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(data))
}

async function sendInngestEvent(name: string, data: unknown): Promise<string> {
  const res = await fetch(`${INNGEST}/e/local`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, data }),
  })
  const result = await res.json() as { ids?: string[] }
  return result.ids?.[0] ?? 'unknown'
}

const NEMOTRON_SYSTEM = `You are a video production pipeline architect advising the Splicewerk team.
Stack: NVIDIA NIM (Nemotron) for AI prompts and advice, Runway Gen-4 Turbo for cinematic video effects,
Shotstack for cloud video assembly, sharp + ffmpeg for local processing, Inngest for pipeline orchestration.
Current project: Autobahn Syndicate brand logo reveal — German automotive performance brand.
Colors: #E02828 red, #F46E2C orange. Font: Montserrat.
Be direct, specific, and actionable.`

// ─── Server ───────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = req.url ?? '/'

  // Inngest function handler
  if (url.startsWith('/api/inngest')) {
    return handler(req, res)
  }

  // Dashboard UI
  if (url === '/' || url === '/dashboard') {
    const html = await fs.readFile(DASHBOARD, 'utf-8')
    res.writeHead(200, { 'Content-Type': 'text/html' })
    return res.end(html)
  }

  // Trigger logo reveal pipeline
  if (url === '/api/trigger' && req.method === 'POST') {
    const body = await readBody(req) as Record<string, unknown>
    const id = await sendInngestEvent('brand/logo-reveal-requested', {
      projectDir:     body.projectDir     ?? 'projects/cinematic-intro',
      force:          body.force          ?? false,
      forceRunway:    body.forceRunway    ?? false,
      baselinePrompt: body.baselinePrompt ?? false,
    })
    return json(res, { id })
  }

  // Approve Runway gate
  if (url === '/api/approve' && req.method === 'POST') {
    const body = await readBody(req) as Record<string, unknown>
    const id = await sendInngestEvent('brand/approved', { note: body.note ?? 'Approved from dashboard' })
    return json(res, { id })
  }

  // Recent Inngest runs (local dev server uses GraphQL)
  if (url === '/api/runs') {
    try {
      const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const gql = {
        query: `{ runs(filter: { from: "${from}" }, orderBy: [{ field: QUEUED_AT, direction: DESC }], first: 10) {
          edges { node { id status startedAt endedAt function { slug } } }
        } }`,
      }
      const r = await fetch(`${INNGEST}/v0/gql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gql),
      })
      const gqlData = await r.json() as { data?: { runs?: { edges?: Array<{ node: unknown }> } } }
      const edges = gqlData.data?.runs?.edges ?? []
      type GqlNode = { id: string; status: string; startedAt: string; endedAt?: string; function?: { slug: string } }
      const runs = edges.map((e: { node: GqlNode }) => ({
        id: e.node.id,
        functionId: e.node.function?.slug ?? 'unknown',
        status: e.node.status.charAt(0).toUpperCase() + e.node.status.slice(1).toLowerCase() as string,
        startedAt: e.node.startedAt,
        endedAt: e.node.endedAt,
      }))
      return json(res, { runs })
    } catch {
      return json(res, { runs: [] })
    }
  }

  // Pending prompt for approval display
  if (url.startsWith('/api/pending-prompt')) {
    // Read the Nemotron-generated prompt from the last run log (best-effort)
    try {
      const logPath = 'projects/cinematic-intro/.pending-prompt'
      const prompt = await fs.readFile(logPath, 'utf-8')
      return json(res, { prompt })
    } catch {
      return json(res, { prompt: null })
    }
  }

  // Nemotron chat
  if (url === '/api/nemotron' && req.method === 'POST') {
    const body  = await readBody(req) as Record<string, unknown>
    const message = String(body.message ?? '')
    const history = (body.history as Array<{ role: string; content: string }>) ?? []

    const apiKey = process.env.NVIDIA_API_KEY
    if (!apiKey) return json(res, { reply: 'NVIDIA_API_KEY not configured.' }, 500)

    const messages = [
      { role: 'system' as const, content: NEMOTRON_SYSTEM },
      ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: message },
    ]

    const result = await callLLM(messages, { model: NEMOTRON, temperature: 0.4, maxTokens: 800 }, NIM_URL, `Bearer ${apiKey}`)
    return json(res, { reply: result.ok ? result.value : `Error: ${result.error}` })
  }

  // Service credits status
  if (url === '/api/credits') {
    const apiKey = process.env.NVIDIA_API_KEY ?? ''
    const elevenKey = process.env.ELEVENLABS_API_KEY ?? ''
    const runwayKey = process.env.RUNWAY_API_KEY ?? ''

    const services = await Promise.allSettled([
      // ElevenLabs subscription
      elevenKey
        ? fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': elevenKey } })
            .then(r => r.json() as Promise<Record<string, unknown>>)
        : Promise.resolve(null),
      // Runway — no public credits endpoint, just ping health
      runwayKey ? Promise.resolve({ status: 'configured' }) : Promise.resolve(null),
      // NIM — just check key is set
      apiKey ? Promise.resolve({ status: 'configured' }) : Promise.resolve(null),
    ])

    const [eleven, runway, nim] = services

    const elevenData = eleven.status === 'fulfilled' ? eleven.value as Record<string, unknown> : null
    return json(res, {
      services: [
        {
          name: 'NVIDIA NIM (Nemotron)',
          configured: !!apiKey,
          status: apiKey ? 'ready' : 'missing key',
          note: 'Pay-per-token — monitor at build.nvidia.com',
          url: 'https://build.nvidia.com',
        },
        {
          name: 'Runway Gen-4',
          configured: !!runwayKey,
          status: runwayKey ? 'ready' : 'missing key',
          note: '~125 credits per 10s generation',
          url: 'https://app.runwayml.com',
          costPerRun: '~125 credits',
        },
        {
          name: 'Shotstack',
          configured: !!process.env.SHOTSTACK_API_KEY,
          status: process.env.SHOTSTACK_API_KEY ? 'ready' : 'missing key',
          note: '~$0.10 per render',
          url: 'https://dashboard.shotstack.io',
          costPerRun: '~$0.10',
        },
        {
          name: 'ElevenLabs',
          configured: !!elevenKey,
          status: elevenKey ? 'ready' : 'missing key',
          note: '~6 credits/sec for SFX',
          url: 'https://elevenlabs.io',
          charactersUsed: elevenData?.character_count ?? null,
          charactersLimit: elevenData?.character_limit ?? null,
        },
      ]
    })
  }

  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, () => {
  console.log(`\n[Splicewerk] Dashboard → http://localhost:${PORT}`)
  console.log(`[Splicewerk] Inngest   → ${INNGEST}`)
  console.log(`[Splicewerk] Functions → ${INNGEST}/functions\n`)
})
