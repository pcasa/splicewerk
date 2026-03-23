import 'dotenv/config'
import * as fs from 'node:fs/promises'
import { createWriteStream, mkdirSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { serve } from 'inngest/node'
import busboy from 'busboy'
import { inngest } from './inngest/client.js'
import { produceVideo } from './inngest/functions/produce-video.js'
import { logoReveal } from './inngest/functions/logo-reveal.js'
import { callLLM } from './services/llm.js'
import { logPrompt, getRecentRuns, getRunCosts, getRunCostsSummary, getPromptLogs } from '@splicewerk/db'

const handler = serve({ client: inngest, functions: [produceVideo, logoReveal] })
const PORT      = Number(process.env.PORT ?? 3000)
const INNGEST   = 'http://localhost:8288'
const NIM_URL   = 'https://integrate.api.nvidia.com/v1'
const NEMOTRON  = 'nvidia/nemotron-3-nano-30b-a3b'
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

const NEMOTRON_SYSTEM = `Autobahn Syndicate's Video Production AI. User Inputs: Media (clips/images) + Plain Language Instructions. Output: Optimized EDL. Brand Guidelines: Colors #E02828 & #F46E2C, Montserrat Font. Prioritize Dynamic, High-Performance Aesthetic. Execute via Splicewerk Pipeline (ffmpeg, Runway Gen-4, Shotstack).`

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

  // Recent Inngest runs (DB first, fallback to Inngest GraphQL)
  if (url === '/api/runs') {
    try {
      const rows = await getRecentRuns(10)
      if (rows.length > 0) {
        return json(res, { runs: rows.map(r => ({ id: r.run_id, functionId: r.function_id, status: r.status, startedAt: r.started_at, endedAt: r.ended_at })) })
      }
    } catch {
      // fall through to Inngest GraphQL
    }

    // Fallback: Inngest GraphQL (local dev before any DB runs exist)
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

  // Nemotron chat — SSE streaming
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

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Type',
    })

    const sendEvent = (event: string, data: string) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    try {
      const nimRes = await fetch(`${NIM_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: NEMOTRON, messages, stream: true, temperature: 0.4, max_tokens: 800 }),
      })

      if (!nimRes.ok || !nimRes.body) {
        sendEvent('error', `NIM error: HTTP ${nimRes.status}`)
        res.end()
        return
      }

      const reader = nimRes.body.getReader()
      req.on('close', () => { void reader.cancel() })
      const decoder = new TextDecoder()
      let buffer = ''
      let fullContent = ''
      let fullThinking = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') continue
          try {
            const chunk = JSON.parse(data)
            const delta = chunk.choices?.[0]?.delta
            if (!delta) continue
            if (delta.reasoning_content) {
              fullThinking += delta.reasoning_content
              sendEvent('thinking', delta.reasoning_content)
            }
            if (delta.content) {
              fullContent += delta.content
              sendEvent('token', delta.content)
            }
          } catch { /* skip malformed chunks */ }
        }
      }

      sendEvent('done', '')
      void logPrompt({
        source: 'ui-chat',
        model: NEMOTRON,
        messages_in: messages,
        response_out: fullContent || fullThinking,
        metadata: { historyLength: history.length },
      }).catch(err => console.warn('[DB] logPrompt (ui-chat) failed:', err))
    } catch (err) {
      sendEvent('error', err instanceof Error ? err.message : String(err))
    }

    res.end()
    return
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

  // Cost ledger — recent run costs from DB
  if (url === '/api/costs') {
    try {
      const runId = new URL(url, 'http://localhost').searchParams.get('runId') ?? undefined
      const costs = runId ? await getRunCosts(runId) : []
      return json(res, { costs })
    } catch {
      return json(res, { costs: [] })
    }
  }

  // Cost summary — aggregated totals from run_costs view
  if (url === '/api/costs/summary') {
    try {
      const summary = await getRunCostsSummary(20)
      return json(res, { summary })
    } catch {
      return json(res, { summary: [] })
    }
  }

  // Upload assets for video production
  if (url === '/api/upload' && req.method === 'POST') {
    let sessionDir = ''
    const files: string[] = []

    await new Promise<void>((resolve, reject) => {
      const bb = busboy({ headers: req.headers })
      bb.on('field', (name, value) => {
        if (name === 'existingSessionDir' && value.startsWith('projects/uploads-')) {
          sessionDir = value
        }
      })
      bb.on('file', (_field, stream, info) => {
        // sessionDir may still be empty here if field arrives after file;
        // busboy emits fields before files in practice, but we set rawDir lazily
        if (!sessionDir) sessionDir = `projects/uploads-${Date.now()}`
        const rawDir = `${sessionDir}/raw`
        mkdirSync(rawDir, { recursive: true })
        const { filename } = info
        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
        files.push(safeName)
        const dest = `${rawDir}/${safeName}`
        const writeStream = createWriteStream(dest)
        stream.pipe(writeStream)
        writeStream.on('error', reject)
      })
      bb.on('close', resolve)
      bb.on('error', reject)
      req.pipe(bb)
    })

    if (!sessionDir) sessionDir = `projects/uploads-${Date.now()}`
    const rawDir = `${sessionDir}/raw`
    await fs.mkdir(rawDir, { recursive: true })
    return json(res, { sessionDir, rawDir, files })
  }

  // Trigger video production pipeline
  if (url === '/api/produce' && req.method === 'POST') {
    const body = await readBody(req) as Record<string, unknown>
    const sessionDir = String(body.sessionDir ?? '')
    const projectName = String(body.projectName ?? `production-${Date.now()}`)
    const formats = Array.isArray(body.formats) ? body.formats as string[] : ['youtube']
    const dryRun = body.dryRun === true
    let prompt = String(body.prompt ?? '')

    // Prepend intro context if logo reveal exists
    try {
      await fs.access('projects/cinematic-intro/logo-reveal.mp4')
      prompt = `A pre-rendered brand intro video is available at: projects/cinematic-intro/logo-reveal.mp4. Include it as the very first segment of the timeline.\n\n${prompt}`
    } catch { /* no intro available */ }

    const id = await sendInngestEvent('video/production-requested', {
      prompt,
      assetsDir: `${sessionDir}/raw`,
      formats,
      projectName,
      dryRun,
    })

    return json(res, { id, sessionDir, projectName })
  }

  // Serve local project output files (videos, images)
  if (url.startsWith('/media/projects/')) {
    const filePath = url.replace('/media/', '')
    try {
      const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
      const mimeTypes: Record<string, string> = {
        mp4: 'video/mp4', mov: 'video/quicktime', jpg: 'image/jpeg',
        jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
      }
      const mime = mimeTypes[ext] ?? 'application/octet-stream'
      const stat = await fs.stat(filePath)
      const range = req.headers.range

      if (range && mime.startsWith('video/')) {
        const parts = range.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0]!, 10)
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1
        const chunkSize = end - start + 1
        const fileStream = (await import('node:fs')).createReadStream(filePath, { start, end })
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mime,
        })
        fileStream.pipe(res)
      } else {
        res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' })
        const fileStream = (await import('node:fs')).createReadStream(filePath)
        fileStream.pipe(res)
      }
    } catch {
      res.writeHead(404)
      res.end('Not found')
    }
    return
  }

  // Single run detail — run record + costs + prompt logs
  const runDetailMatch = url.match(/^\/api\/runs\/([^?]+)$/)
  if (runDetailMatch && req.method === 'GET') {
    const runId = runDetailMatch[1]!
    try {
      const [allRuns, costs, prompts] = await Promise.all([
        getRecentRuns(50),
        getRunCosts(runId),
        getPromptLogs(20, runId),
      ])
      const run = allRuns.find(r => r.run_id === runId) ?? null
      return json(res, { run, costs, prompts })
    } catch {
      return json(res, { run: null, costs: [], prompts: [] })
    }
  }

  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, () => {
  console.log(`\n[Splicewerk] Dashboard → http://localhost:${PORT}`)
  console.log(`[Splicewerk] Inngest   → ${INNGEST}`)
  console.log(`[Splicewerk] Functions → ${INNGEST}/functions\n`)
})
