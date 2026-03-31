import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AssetManifest } from '../edl/types.js'
import { callLLM, generateEDL } from './llm.js'

// Prevent logPrompt from making real Supabase fetch calls in tests
vi.mock('@splicewerk/db', () => ({
  logPrompt: vi.fn().mockResolvedValue(undefined),
  upsertRun: vi.fn().mockResolvedValue(undefined),
  updateRunStatus: vi.fn().mockResolvedValue(undefined),
  logCost: vi.fn().mockResolvedValue(undefined),
}))

// ─── Fixtures ───

const mockEDL = {
  project: {
    title: 'Test',
    targetDurationSeconds: 15,
    aspectRatio: '16:9',
    resolution: '1920x1080',
    outputFormats: ['youtube'],
  },
  missingAssets: [],
  timeline: [{ id: 'seg1', type: 'clip', processor: 'ffmpeg', source: 'test.mp4' }],
  audio: {},
  thumbnail: { type: 'single', style: 'default' },
}

const mockAssetManifest: AssetManifest = {
  rootDir: '/videos',
  catalogedAt: '2025-01-01T00:00:00Z',
  files: [
    {
      path: '/videos/clip1.mp4',
      filename: 'clip1.mp4',
      type: 'video',
      duration: 10,
      width: 1920,
      height: 1080,
      fileSize: 1024000,
    },
    {
      path: '/videos/music.mp3',
      filename: 'music.mp3',
      type: 'audio',
      duration: 60,
      fileSize: 512000,
    },
  ],
}

// ─── Helpers ───

function makeOkFetch(content: string, totalTokens = 150) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      choices: [{ message: { content } }],
      usage: { total_tokens: totalTokens },
    }),
  })
}

function make503Fetch() {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 503,
    statusText: 'Service Unavailable',
    json: async () => ({}),
  })
}

// ─── Tests ───

describe('callLLM', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('sends correct request body (model, messages, stream: false)', async () => {
    const fetchMock = makeOkFetch('hello')
    global.fetch = fetchMock as unknown as typeof fetch

    const messages = [{ role: 'user' as const, content: 'hi' }]
    await callLLM(messages, { model: 'test-model' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/v1/chat/completions')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.model).toBe('test-model')
    expect(body.messages).toEqual(messages)
    expect(body.stream).toBe(false)
  })

  it('returns { ok: true, value: content } on success', async () => {
    global.fetch = makeOkFetch('generated content') as unknown as typeof fetch

    const result = await callLLM([{ role: 'user', content: 'hello' }])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe('generated content')
    }
  })

  it('returns tokens from usage.total_tokens', async () => {
    global.fetch = makeOkFetch('response', 420) as unknown as typeof fetch

    const result = await callLLM([{ role: 'user', content: 'hi' }])

    expect(result.tokens).toBe(420)
  })

  it('returns tokens: 0 when usage is absent', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: 'hi' } }] }), // no usage field
    }) as unknown as typeof fetch

    const result = await callLLM([{ role: 'user', content: 'hi' }])

    expect(result.tokens).toBe(0)
  })

  it('retries 3 times on 503 before returning { ok: false }', async () => {
    const fetchMock = make503Fetch()
    global.fetch = fetchMock as unknown as typeof fetch

    // callLLM with retries:3 will attempt 3 times, sleeping between each
    // We need to advance fake timers to unblock the sleeps
    const promise = callLLM([{ role: 'user', content: 'hi' }], { retries: 3 })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('503')
    }
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('falls back to nemotron-3-nano after cloud model exhausts retries', async () => {
    let callCount = 0
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount <= 3) {
        return Promise.resolve({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          json: async () => ({}),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(mockEDL) } }],
        }),
      })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    // generateEDL calls callLLM for cloud (3 attempts, fails), then callLLM for nano (1 attempt)
    const promise = generateEDL('make a video', mockAssetManifest)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.ok).toBe(true)
    // Verify fallback model was used in the 4th fetch call
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const fourthCallBody = JSON.parse(
      (fetchMock.mock.calls[3] as [string, RequestInit])[1].body as string
    ) as Record<string, unknown>
    expect(fourthCallBody.model).toBe('nemotron-3-nano:4b')
  })

  it('uses ollama provider when NIM fails and Ollama succeeds', async () => {
    let callCount = 0
    global.fetch = vi.fn().mockImplementation((url: string) => {
      callCount++
      // First 3 calls go to NIM and fail; subsequent calls (Ollama) succeed
      const isNim = (url as string).includes('integrate.api.nvidia.com')
      if (isNim) {
        return Promise.resolve({ ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({}) })
      }
      return Promise.resolve({
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(mockEDL) } }],
          usage: { total_tokens: 300 },
        }),
      })
    }) as unknown as typeof fetch

    const promise = generateEDL('make a video', mockAssetManifest)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.ok).toBe(true)
    // Verify the fallback (Ollama) call used the local base URL
    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, unknown][]
    const ollamaCall = calls.find(([url]) => url.includes('localhost'))
    expect(ollamaCall).toBeDefined()
  })
})

describe('generateEDL', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('strips markdown fences before parsing JSON', async () => {
    const withFences = '```json\n' + JSON.stringify(mockEDL) + '\n```'
    global.fetch = makeOkFetch(withFences) as unknown as typeof fetch

    const result = await generateEDL('make a video', mockAssetManifest)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.project.title).toBe('Test')
    }
  })

  it('returns { ok: false } when LLM returns invalid JSON', async () => {
    global.fetch = makeOkFetch('not valid json at all }{') as unknown as typeof fetch

    const result = await generateEDL('make a video', mockAssetManifest)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Failed to parse')
    }
  })

  it('returns { ok: false } when parsed JSON is missing required fields', async () => {
    const incomplete = { project: { title: 'test' } } // missing timeline, audio, thumbnail
    global.fetch = makeOkFetch(JSON.stringify(incomplete)) as unknown as typeof fetch

    const result = await generateEDL('make a video', mockAssetManifest)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('missing required EDL fields')
    }
  })

  it('includes asset filenames in the system prompt', async () => {
    const fetchMock = makeOkFetch(JSON.stringify(mockEDL))
    global.fetch = fetchMock as unknown as typeof fetch

    await generateEDL('make a video', mockAssetManifest)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { messages: { role: string; content: string }[] }
    const systemMessage = body.messages.find((m) => m.role === 'system')
    expect(systemMessage?.content).toContain('clip1.mp4')
    expect(systemMessage?.content).toContain('music.mp3')
  })

  it('includes EDL schema description in system prompt', async () => {
    const fetchMock = makeOkFetch(JSON.stringify(mockEDL))
    global.fetch = fetchMock as unknown as typeof fetch

    await generateEDL('make a video', mockAssetManifest)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { messages: { role: string; content: string }[] }
    const systemMessage = body.messages.find((m) => m.role === 'system')
    expect(systemMessage?.content).toContain('EDL (Edit Decision List) JSON Schema')
    expect(systemMessage?.content).toContain('timeline')
    expect(systemMessage?.content).toContain('thumbnail')
  })
})
