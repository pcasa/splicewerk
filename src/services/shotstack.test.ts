import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { uploadFile, renderEdit, assembleClips } from './shotstack.js'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    stat: vi.fn().mockResolvedValue({ size: 1024 * 512 }),
    readFile: vi.fn().mockResolvedValue(Buffer.from('fake-video-bytes')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  }
})

// ─── Helpers ───

function makePresignedResponse(id = 'src-123', uploadUrl = 'https://s3.example.com/upload?x-amz-security-token=abc') {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: { id, attributes: { url: uploadUrl } } }),
    text: async () => '',
  }
}

function makeS3PutResponse() {
  return { ok: true, status: 200, text: async () => '' }
}

function makeIngestPollResponse(status: 'processing' | 'ready' | 'failed', source = 'https://cdn.shotstack.io/source.mp4') {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: { attributes: { status, source } } }),
  }
}

function makeRenderSubmitResponse(id = 'render-456') {
  return {
    ok: true,
    status: 200,
    json: async () => ({ response: { id } }),
    text: async () => '',
  }
}

function makeRenderPollResponse(status: 'queued' | 'rendering' | 'done' | 'failed', url = 'https://cdn.shotstack.io/out.mp4') {
  return {
    ok: true,
    status: 200,
    json: async () => ({ response: { id: 'render-456', status, url, error: undefined } }),
  }
}

function makeVideoDownloadResponse() {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(16),
  }
}

// ─── Setup ───

beforeEach(() => {
  process.env.SHOTSTACK_API_KEY = 'test-key'
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete process.env.SHOTSTACK_API_KEY
})

// ─── uploadFile tests ───

describe('uploadFile', () => {
  it('happy path: presign → S3 PUT → poll until ready → return hosted URL', async () => {
    let callCount = 0
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      callCount++
      if ((opts?.method ?? 'GET') === 'POST' && String(url).includes('/upload')) {
        return Promise.resolve(makePresignedResponse())
      }
      if ((opts?.method ?? 'GET') === 'PUT') {
        return Promise.resolve(makeS3PutResponse())
      }
      if (String(url).includes('/sources/')) {
        // First poll returns 'processing', second returns 'ready'
        return Promise.resolve(
          callCount < 4
            ? makeIngestPollResponse('processing')
            : makeIngestPollResponse('ready', 'https://cdn.shotstack.io/ready.mp4')
        )
      }
      return Promise.resolve({ ok: false, status: 404 })
    }) as unknown as typeof fetch

    const promise = uploadFile('/tmp/video.mp4')
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe('https://cdn.shotstack.io/ready.mp4')
    }
  })

  it('returns { ok: false } when ingest poll returns failed', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if ((opts?.method ?? 'GET') === 'POST') return Promise.resolve(makePresignedResponse())
      if ((opts?.method ?? 'GET') === 'PUT') return Promise.resolve(makeS3PutResponse())
      return Promise.resolve(makeIngestPollResponse('failed'))
    }) as unknown as typeof fetch

    const promise = uploadFile('/tmp/video.mp4')
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('failed')
    }
  })

  it('returns { ok: false } when presign request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 401, text: async () => 'Unauthorized',
    }) as unknown as typeof fetch

    const result = await uploadFile('/tmp/video.mp4')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('401')
    }
  })
})

// ─── renderEdit tests ───

describe('renderEdit', () => {
  const mockEdit = {
    timeline: {
      background: '#000000',
      tracks: [{
        clips: [{ asset: { type: 'video' as const, src: 'https://cdn.example.com/clip.mp4' }, start: 0, length: 10 }],
      }],
    },
    output: { format: 'mp4' as const, size: { width: 1920, height: 1080 }, fps: 30, quality: 'high' as const },
  }

  it('happy path: submit → poll through rendering → done → download → return path', async () => {
    let pollCount = 0
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if ((opts?.method ?? 'GET') === 'POST') return Promise.resolve(makeRenderSubmitResponse())
      if (String(url).includes('/render/')) {
        pollCount++
        return Promise.resolve(
          pollCount < 3
            ? makeRenderPollResponse('rendering')
            : makeRenderPollResponse('done', 'https://cdn.shotstack.io/out.mp4')
        )
      }
      // video download
      return Promise.resolve(makeVideoDownloadResponse())
    }) as unknown as typeof fetch

    const promise = renderEdit(mockEdit, '/tmp/output.mp4')
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe('/tmp/output.mp4')
    }
  })

  it('returns { ok: false } when render poll returns failed', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if ((opts?.method ?? 'GET') === 'POST') return Promise.resolve(makeRenderSubmitResponse())
      return Promise.resolve(makeRenderPollResponse('failed'))
    }) as unknown as typeof fetch

    const promise = renderEdit(mockEdit, '/tmp/output.mp4')
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('failed')
    }
  })

  it('sends correct x-api-key header', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if ((opts?.method ?? 'GET') === 'POST') return Promise.resolve(makeRenderSubmitResponse())
      if (String(url).includes('/render/')) return Promise.resolve(makeRenderPollResponse('done'))
      return Promise.resolve(makeVideoDownloadResponse())
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const promise = renderEdit(mockEdit, '/tmp/output.mp4')
    await vi.runAllTimersAsync()
    await promise

    const [, submitInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const submitHeaders = submitInit.headers as Record<string, string>
    expect(submitHeaders['x-api-key']).toBe('test-key')
  })

  it('returns { ok: false } when SHOTSTACK_API_KEY is not set', async () => {
    delete process.env.SHOTSTACK_API_KEY
    // getApiKey() throws, renderEdit wraps in try/catch → ok: false
    const result = await renderEdit(mockEdit, '/tmp/output.mp4').catch(() => ({ ok: false as const, error: 'threw' }))
    expect(result.ok).toBe(false)
  })
})

// ─── assembleClips tests ───

describe('assembleClips', () => {
  it('builds sequential clips with correct start times', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if ((opts?.method ?? 'GET') === 'POST') return Promise.resolve(makeRenderSubmitResponse())
      if (String(url).includes('/render/')) return Promise.resolve(makeRenderPollResponse('done'))
      return Promise.resolve(makeVideoDownloadResponse())
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const segments = [
      { url: 'https://cdn.example.com/a.mp4', durationSeconds: 5 },
      { url: 'https://cdn.example.com/b.mp4', durationSeconds: 8 },
      { url: 'https://cdn.example.com/c.mp4', durationSeconds: 3 },
    ]

    const promise = assembleClips(segments, '/tmp/master.mp4')
    await vi.runAllTimersAsync()
    await promise

    const [, submitInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(submitInit.body as string) as {
      timeline: { tracks: { clips: { start: number; length: number }[] }[] }
    }
    const clips = body.timeline.tracks[0]!.clips
    expect(clips[0]!.start).toBe(0)
    expect(clips[0]!.length).toBe(5)
    expect(clips[1]!.start).toBe(5)
    expect(clips[1]!.length).toBe(8)
    expect(clips[2]!.start).toBe(13)
    expect(clips[2]!.length).toBe(3)
  })

  it('includes background music track when provided', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if ((opts?.method ?? 'GET') === 'POST') return Promise.resolve(makeRenderSubmitResponse())
      if (String(url).includes('/render/')) return Promise.resolve(makeRenderPollResponse('done'))
      return Promise.resolve(makeVideoDownloadResponse())
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const promise = assembleClips(
      [{ url: 'https://cdn.example.com/a.mp4', durationSeconds: 10 }],
      '/tmp/master.mp4',
      { backgroundMusic: { url: 'https://cdn.example.com/music.mp3', volume: 0.5 } }
    )
    await vi.runAllTimersAsync()
    await promise

    const [, submitInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(submitInit.body as string) as {
      timeline: { tracks: { clips: { asset: { type: string } }[] }[] }
    }
    expect(body.timeline.tracks).toHaveLength(2)
    expect(body.timeline.tracks[1]!.clips[0]!.asset.type).toBe('audio')
  })
})
