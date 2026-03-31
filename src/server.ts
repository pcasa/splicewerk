import 'dotenv/config'
import * as fs from 'node:fs/promises'
import { createWriteStream, mkdirSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import busboy from 'busboy'
import { serve } from 'inngest/node'
import { inngest } from './inngest/client.js'
import { produceVideo } from './inngest/functions/produce-video.js'
import { logoReveal } from './inngest/functions/logo-reveal.js'
import { enhanceFootage } from './inngest/functions/enhance-footage.js'
import { adaptivePipeline } from './inngest/functions/adaptive-pipeline.js'
import { callLLM, validateVideoOutput } from './services/llm.js'
import { logPrompt, getRecentRuns, getRunCosts, getRunCostsSummary, getPromptLogs } from '@splicewerk/db'

const handler = serve({ client: inngest, functions: [produceVideo, logoReveal, enhanceFootage, adaptivePipeline] })
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

// ─── Disk-based run manifest helpers ─────────────────────────────────────────

type PipelineManifest = {
  runId: string
  userIntent: string
  completedAt: string
  assets: Record<string, string>
  finalOutput: string | null
  completedSteps: Array<{ functionName: string; durationMs: number; inputs: Record<string, unknown>; outputs: Record<string, unknown> }>
  debug: { totalStepsExecuted: number }
}

/** Scan all project dirs and return all pipeline-run manifests, newest first. */
async function scanPipelineManifests(): Promise<PipelineManifest[]> {
  const manifests: PipelineManifest[] = []
  try {
    const entries = await fs.readdir('projects', { withFileTypes: true })
    await Promise.all(entries.filter(e => e.isDirectory()).map(async (e) => {
      const dirPath = path.join('projects', e.name)
      try {
        const files = await fs.readdir(dirPath)
        await Promise.all(
          files.filter(f => f.startsWith('pipeline-run-') && f.endsWith('.json')).map(async (f) => {
            try {
              const raw = await fs.readFile(path.join(dirPath, f), 'utf-8')
              manifests.push(JSON.parse(raw) as PipelineManifest)
            } catch { /* skip malformed */ }
          })
        )
      } catch { /* skip unreadable dir */ }
    }))
  } catch { /* projects dir missing */ }
  return manifests.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
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

  // Video file serving — streams local video files with range request support
  if (url.startsWith('/api/video') && req.method === 'GET') {
    const filePath = new URL(url, 'http://localhost').searchParams.get('path') ?? ''
    // Sanitize: must stay within projects/ directory
    const resolved = path.resolve(filePath)
    const projectsRoot = path.resolve('projects')
    if (!resolved.startsWith(projectsRoot + path.sep) && !resolved.startsWith(projectsRoot)) {
      res.writeHead(403); res.end('Forbidden'); return
    }
    try {
      const stat = await fs.stat(resolved)
      const ext = path.extname(resolved).toLowerCase()
      const mime = ext === '.mov' ? 'video/quicktime' : ext === '.webm' ? 'video/webm' : 'video/mp4'
      const rangeHeader = req.headers.range
      if (rangeHeader) {
        const [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-')
        const start = parseInt(startStr ?? '0', 10)
        const end = endStr ? parseInt(endStr, 10) : stat.size - 1
        const chunkSize = end - start + 1
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mime,
          'Access-Control-Allow-Origin': '*',
        })
        const { createReadStream } = await import('node:fs')
        createReadStream(resolved, { start, end }).pipe(res)
      } else {
        res.writeHead(200, {
          'Content-Length': stat.size,
          'Content-Type': mime,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        })
        const { createReadStream } = await import('node:fs')
        createReadStream(resolved).pipe(res)
      }
    } catch {
      res.writeHead(404); res.end('Not found')
    }
    return
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

  // Trigger footage enhancement pipeline
  if (url === '/api/enhance' && req.method === 'POST') {
    const body = await readBody(req) as Record<string, unknown>
    if (!body.inputVideoPath || !body.projectDir) {
      return json(res, { error: 'inputVideoPath and projectDir are required' }, 400)
    }
    // Auto-copy brand.json from cinematic-intro if not present in projectDir
    const brandJsonDest = path.join(String(body.projectDir), 'brand.json')
    try {
      await fs.access(brandJsonDest)
    } catch {
      await fs.copyFile('projects/cinematic-intro/brand.json', brandJsonDest).catch(() => {})
    }
    const id = await sendInngestEvent('footage/enhance-requested', {
      inputVideoPath: body.inputVideoPath,
      projectDir:     body.projectDir,
      introVideoPath: body.introVideoPath,
      scrollingLines: body.scrollingLines,
      endCardTitle:   body.endCardTitle,
      endCardStats:   body.endCardStats,
      fadeInSec:      body.fadeInSec  ?? 1,
      fadeOutSec:     body.fadeOutSec ?? 1,
      stabilization:  body.stabilization,
    })
    return json(res, { id })
  }

  // Trigger adaptive AI pipeline
  if (url === '/api/pipeline/run' && req.method === 'POST') {
    const body = await readBody(req) as Record<string, unknown>
    if (!body.projectDir || !body.rawFootagePath || !body.userIntent) {
      return json(res, { error: 'projectDir, rawFootagePath, and userIntent are required' }, 400)
    }
    const projectDir = String(body.projectDir)

    // Auto-copy brand.json from cinematic-intro if not present
    const brandJsonDest = path.join(projectDir, 'brand.json')
    try {
      await fs.access(brandJsonDest)
    } catch {
      await fs.copyFile('projects/cinematic-intro/brand.json', brandJsonDest).catch(() => {})
    }

    // Build asset manifest by discovering what exists on disk
    const assets: Record<string, string> = {
      rawFootage:  String(body.rawFootagePath),
      brandConfig: brandJsonDest,
    }

    // Discover brand intro from cinematic-intro project
    const introCandidates = [
      'projects/cinematic-intro/logo-reveal.mp4',
      path.join(projectDir, 'logo-reveal.mp4'),
    ]
    for (const candidate of introCandidates) {
      try {
        await fs.access(candidate)
        assets.brandIntro = candidate
        break
      } catch { /* not found */ }
    }

    const id = await sendInngestEvent('pipeline/run', {
      projectDir,
      assets,
      userIntent: String(body.userIntent),
    })
    return json(res, { id, assets })
  }

  // Approve Runway gate
  if (url === '/api/approve' && req.method === 'POST') {
    const body = await readBody(req) as Record<string, unknown>
    const id = await sendInngestEvent('brand/approved', { note: body.note ?? 'Approved from dashboard' })
    return json(res, { id })
  }

  // Recent Inngest runs (local dev server uses GraphQL)
  if (url === '/api/runs') {
    // Primary source: pipeline-run manifests on disk (persist across restarts)
    const manifests = await scanPipelineManifests()
    type RunEntry = { id: string; functionId: string; status: string; startedAt: string; endedAt?: string; prompt_used?: string; output_url?: string; totalSteps: number }
    const manifestRuns: RunEntry[] = manifests.map(m => ({
      id: m.runId,
      functionId: 'adaptive-pipeline',
      status: 'Completed' as string,
      startedAt: m.completedAt,  // best approximation without start time in manifest
      endedAt: m.completedAt,
      prompt_used: m.userIntent,
      output_url: m.finalOutput ?? undefined,
      totalSteps: m.debug?.totalStepsExecuted ?? 0,
    }))

    // Merge Supabase historical runs (different function types, e.g. logo-reveal, produce-video)
    const manifestIds = new Set(manifestRuns.map(r => r.id))
    try {
      const dbRuns = await getRecentRuns(50)
      for (const r of dbRuns) {
        if (!manifestIds.has(r.run_id)) {
          manifestRuns.push({
            id: r.run_id,
            functionId: r.function_id,
            status: r.status,
            startedAt: r.started_at,
            endedAt: r.ended_at,
            prompt_used: r.prompt_used,
            output_url: r.output_url,
            totalSteps: 0,
          })
          manifestIds.add(r.run_id)
        }
      }
    } catch { /* Supabase unavailable */ }

    // Supplement with live Inngest status (catches currently-running jobs)
    try {
      const from = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // last 2h
      const gql = {
        query: `{ runs(filter: { from: "${from}" }, orderBy: [{ field: QUEUED_AT, direction: DESC }], first: 20) {
          edges { node { id status startedAt endedAt function { slug } } }
        } }`,
      }
      const r = await fetch(`${INNGEST}/v0/gql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gql),
      })
      const gqlData = await r.json() as { data?: { runs?: { edges?: Array<{ node: unknown }> } } }
      type GqlNode = { id: string; status: string; startedAt: string; endedAt?: string; function?: { slug: string } }
      const edges = (gqlData.data?.runs?.edges ?? []) as Array<{ node: GqlNode }>
      for (const e of edges) {
        const status = e.node.status.charAt(0).toUpperCase() + e.node.status.slice(1).toLowerCase()
        if (status !== 'Completed' && !manifestIds.has(e.node.id)) {
          manifestRuns.unshift({
            id: e.node.id,
            functionId: e.node.function?.slug ?? 'adaptive-pipeline',
            status,
            startedAt: e.node.startedAt,
            endedAt: e.node.endedAt,
            prompt_used: undefined,
            output_url: undefined,
            totalSteps: 0,
          })
        }
      }
    } catch { /* Inngest unavailable — disk manifests are enough */ }

    // Sort newest first
    manifestRuns.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())

    return json(res, { runs: manifestRuns })
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

    const t0 = Date.now()
    const result = await callLLM(messages, { model: NEMOTRON, temperature: 0.4, maxTokens: 800 }, NIM_URL, `Bearer ${apiKey}`)
    const latencyMs = Date.now() - t0

    // Log to prompt_logs (non-blocking, best-effort)
    logPrompt({
      source: 'ui-chat',
      model: NEMOTRON,
      messages_in: messages,
      response_out: result.ok ? result.value : undefined,
    }).catch(() => {})

    return json(res, { reply: result.ok ? result.value : `Error: ${result.error}`, latencyMs })
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

  // Single run detail — manifest + validation + costs from DB (if available)
  const runDetailMatch = url.match(/^\/api\/runs\/([^?]+)$/)
  if (runDetailMatch && req.method === 'GET') {
    const runId = decodeURIComponent(runDetailMatch[1]!)
    try {
      // Find the manifest for this run
      const manifests = await scanPipelineManifests()
      const manifest = manifests.find(m => m.runId === runId) ?? null

      const run = manifest ? {
        run_id: manifest.runId,
        function_id: 'adaptive-pipeline',
        status: 'Completed',
        started_at: manifest.completedAt,
        ended_at: manifest.completedAt,
        prompt_used: manifest.userIntent,
        output_url: manifest.finalOutput ?? undefined,
      } : null

      const steps = manifest?.completedSteps ?? []

      // Try DB for costs/prompts (non-fatal if Supabase is down)
      let costs: unknown[] = []
      let prompts: unknown[] = []
      try {
        ;[costs, prompts] = await Promise.all([
          getRunCosts(runId),
          getPromptLogs(20, runId),
        ])
      } catch { /* Supabase unavailable */ }

      return json(res, { run, steps, costs, prompts })
    } catch (err) {
      return json(res, { run: null, steps: [], costs: [], prompts: [], error: String(err) })
    }
  }

  // List all project directories — uploads AND named projects — with video files and pipeline run manifests
  if (url === '/api/projects' && req.method === 'GET') {
    try {
      const projectsRoot = 'projects'
      const entries = await fs.readdir(projectsRoot, { withFileTypes: true })
      const allDirs = entries.filter(e => e.isDirectory()).map(e => e.name)

      const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm'])

      const projects = await Promise.all(
        allDirs.map(async (dirName) => {
          const dirPath = `${projectsRoot}/${dirName}`
          let files: Array<{ name: string; path: string; size: number; mtime: number }> = []
          let pipelineRuns: unknown[] = []

          try {
            const dirEntries = await fs.readdir(dirPath, { withFileTypes: true })

            // Video files
            const videoFiles = dirEntries.filter(e => {
              if (!e.isFile()) return false
              const ext = e.name.slice(e.name.lastIndexOf('.')).toLowerCase()
              return VIDEO_EXTS.has(ext)
            })
            files = await Promise.all(
              videoFiles.map(async (e) => {
                const filePath = `${dirPath}/${e.name}`
                const stat = await fs.stat(filePath)
                return { name: e.name, path: filePath, size: stat.size, mtime: stat.mtimeMs }
              })
            )
            files.sort((a, b) => b.mtime - a.mtime)

            // Pipeline run manifests
            const runFiles = dirEntries.filter(e => e.isFile() && e.name.startsWith('pipeline-run-') && e.name.endsWith('.json'))
            pipelineRuns = await Promise.all(
              runFiles.map(async (e) => {
                try {
                  const raw = await fs.readFile(`${dirPath}/${e.name}`, 'utf-8')
                  return JSON.parse(raw)
                } catch { return null }
              })
            )
            pipelineRuns = pipelineRuns.filter(Boolean)
            // Sort newest first by completedAt
            ;(pipelineRuns as Array<{ completedAt?: string }>).sort((a, b) =>
              (b.completedAt ?? '').localeCompare(a.completedAt ?? '')
            )
          } catch { /* ignore unreadable dirs */ }

          return { sessionDir: dirPath, name: dirName, files, pipelineRuns }
        })
      )

      // Return dirs that have videos OR pipeline runs, newest-modified first
      const active = projects.filter(p => p.files.length > 0 || p.pipelineRuns.length > 0)
      const withMtime = await Promise.all(
        active.map(async p => {
          try { const s = await fs.stat(p.sessionDir); return { ...p, mtime: s.mtimeMs } }
          catch { return { ...p, mtime: 0 } }
        })
      )
      withMtime.sort((a, b) => b.mtime - a.mtime)

      return json(res, { projects: withMtime })
    } catch (err) {
      return json(res, { projects: [], error: String(err) }, 500)
    }
  }

  // Validation result for a specific run (stable ID-based lookup)
  if (url.startsWith('/api/validation/') && req.method === 'GET') {
    const runId = decodeURIComponent(url.slice('/api/validation/'.length))
    try {
      // Try DB first: adaptive_pipeline_runs stores project_dir per run_id
      let projectDir: string | null = null
      if (process.env.SUPABASE_URL) {
        try {
          const { getAdaptivePipelineRun } = await import('@splicewerk/db')
          const row = await getAdaptivePipelineRun(runId)
          if (row?.project_dir) projectDir = row.project_dir
        } catch { /* fall through to disk scan */ }
      }

      // Disk fallback: scan all project dirs for a validation file matching runId
      if (!projectDir) {
        const projectsRoot = 'projects'
        try {
          const projectDirs = await fs.readdir(projectsRoot)
          outer: for (const dirName of projectDirs) {
            const dir = path.join(projectsRoot, dirName)
            let entries: string[]
            try { entries = await fs.readdir(dir) } catch { continue }
            for (const name of entries) {
              if (!name.startsWith('validation-') || !name.endsWith('.json')) continue
              const raw = await fs.readFile(path.join(dir, name), 'utf-8')
              const v = JSON.parse(raw) as Record<string, unknown>
              if (v.runId === runId) { projectDir = dir; break outer }
            }
          }
        } catch { /* projects dir missing */ }
      }

      if (!projectDir) {
        return json(res, { validation: null, error: `No validation found for run ${runId}` }, 404)
      }

      // Read the matching validation file from project dir
      const entries = await fs.readdir(projectDir)
      const validationFiles = entries
        .filter(name => name.startsWith('validation-') && name.endsWith('.json'))

      for (const name of validationFiles) {
        const raw = await fs.readFile(path.join(projectDir, name), 'utf-8')
        const v = JSON.parse(raw) as Record<string, unknown>
        if (v.runId === runId) return json(res, { validation: v })
      }

      return json(res, { validation: null, error: `No validation found for run ${runId}` }, 404)
    } catch (err) {
      return json(res, { validation: null, error: String(err) }, 500)
    }
  }

  // All validation results for a project directory (legacy — kept for backward compat)
  if (url.startsWith('/api/validations/') && req.method === 'GET') {
    const projectName = decodeURIComponent(url.slice('/api/validations/'.length))
    try {
      const dir = path.join('projects', projectName)
      const entries = await fs.readdir(dir)
      const validationFiles = entries
        .filter(name => name.startsWith('validation-') && name.endsWith('.json'))
        .sort()
        .reverse() // newest first (lexicographic desc works for timestamped names)

      const validations = await Promise.all(
        validationFiles.map(async (name) => {
          const raw = await fs.readFile(path.join(dir, name), 'utf-8')
          return JSON.parse(raw) as unknown
        })
      )

      return json(res, { validations })
    } catch (err) {
      return json(res, { validations: [], error: String(err) })
    }
  }

  // Validate a completed enhance pipeline output using Maverick vision model
  if (url === '/api/validate' && req.method === 'POST') {
    const body      = await readBody(req) as Record<string, unknown>
    const projectDir = String(body.projectDir ?? '')
    const runId      = String(body.runId ?? '')
    const pipeline   = (body.pipeline ?? {}) as Record<string, unknown>

    if (!process.env.NVIDIA_API_KEY) return json(res, { error: 'NVIDIA_API_KEY not configured' }, 500)

    const videoPath = path.join(projectDir, 'enhanced-final.mp4')
    try { await fs.access(videoPath) }
    catch { return json(res, { error: `enhanced-final.mp4 not found in ${projectDir}` }, 404) }

    // ── Extract 5 key frames with ffmpeg ──────────────────────────────────────
    // Timestamps: 0s (intro start), 3s (title card mid), 14s (main footage start),
    // midpoint of main footage, and near the end (end card)
    const framesDir = path.join(projectDir, 'validation-frames')
    await fs.mkdir(framesDir, { recursive: true })

    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)

    // Get video duration first
    let duration = 60
    try {
      const probe = await execFileAsync('/opt/homebrew/bin/ffprobe', [
        '-v', 'quiet', '-print_format', 'json', '-show_format', videoPath,
      ])
      const info = JSON.parse(probe.stdout) as { format?: { duration?: string } }
      duration = parseFloat(info.format?.duration ?? '60')
    } catch { /* use default */ }

    const timestamps = [
      0,
      3,
      14,
      Math.round(duration * 0.5),
      Math.max(duration - 3, 15),
    ]

    const framePaths: string[] = []
    for (const t of timestamps) {
      const framePath = path.join(framesDir, `frame-${t}s.jpg`)
      try {
        await execFileAsync('/opt/homebrew/bin/ffmpeg', [
          '-y', '-ss', String(t), '-i', videoPath,
          '-frames:v', '1', '-q:v', '3', framePath,
        ])
        framePaths.push(framePath)
      } catch { /* skip failed frame */ }
    }

    if (framePaths.length === 0) {
      return json(res, { error: 'Could not extract any frames from video' }, 500)
    }

    // ── Build context description for Maverick ─────────────────────────────
    const description = `Autobahn Syndicate YouTube video — German automotive performance brand.
Assembly: [Brand intro logo-reveal] → [10s scrolling title card] → [Stabilized phone footage with fade in/out] → [4s branded end card]
Title card lines: ${JSON.stringify(pipeline.scrollingLines ?? [])}
End card: "${pipeline.endCardTitle ?? ''}" / "${pipeline.endCardStats ?? ''}"
Review for: black gaps, audio bleed, stabilization quality, title card readability, end card appearance, and overall production quality.`

    // ── Call Maverick vision model ─────────────────────────────────────────
    const result = await validateVideoOutput(framePaths, description, runId)
    if (!result.ok) return json(res, { error: result.error }, 500)

    const validation = result.value as Record<string, unknown>
    validation.runId       = runId
    validation.projectName = path.basename(projectDir)
    validation.timestamp   = new Date().toISOString()

    // Persist so ValidationPanel can load it later
    try {
      await fs.writeFile(
        path.join(projectDir, `validation-${Date.now()}.json`),
        JSON.stringify(validation, null, 2),
        'utf-8'
      )
    } catch { /* non-fatal */ }

    // Clean up frames
    await fs.rm(framesDir, { recursive: true, force: true }).catch(() => {})

    return json(res, { validation })
  }

  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, () => {
  console.log(`\n[Splicewerk] Dashboard → http://localhost:${PORT}`)
  console.log(`[Splicewerk] Inngest   → ${INNGEST}`)
  console.log(`[Splicewerk] Functions → ${INNGEST}/functions\n`)
})
