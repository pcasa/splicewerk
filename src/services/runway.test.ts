import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fsPromises from 'node:fs/promises'

// ─── Mock dotenv ─────────────────────────────────────────────────────────────

vi.mock('dotenv/config', () => ({}))

// ─── Mock RunwayML SDK ────────────────────────────────────────────────────────
// vi.mock() is hoisted, so we use vi.hoisted() to create mock fns accessible
// both inside the factory and in test assertions.

const mockImageToVideoCreate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: 'task-123' })
)
const mockTextToVideoCreate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: 'task-123' })
)
const mockVideoToVideoCreate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: 'task-123' })
)
const mockTasksRetrieve = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    id: 'task-123',
    status: 'SUCCEEDED',
    output: ['https://example.com/video.mp4'],
    createdAt: '2024-01-01T00:00:00Z',
  })
)

vi.mock('@runwayml/sdk', () => {
  const mockClient = {
    imageToVideo: { create: mockImageToVideoCreate },
    textToVideo: { create: mockTextToVideoCreate },
    videoToVideo: { create: mockVideoToVideoCreate },
    tasks: { retrieve: mockTasksRetrieve },
  }
  return { default: vi.fn().mockImplementation(() => mockClient) }
})

// ─── Mock node:fs/promises ────────────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from('fake-image-data')),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

// ─── Mock fetch ───────────────────────────────────────────────────────────────

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  arrayBuffer: async () => new ArrayBuffer(1024),
})

// ─── Helper to run a function that internally uses setTimeout ─────────────────

/**
 * Runs an async function that internally relies on setTimeout (pollTask).
 * Uses fake timers so tests don't wait 5 real seconds per poll attempt.
 */
async function runWithFakeTimers<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers()
  try {
    const promise = fn()
    // Advance all pending timers (the 5s setTimeout in pollTask)
    await vi.runAllTimersAsync()
    return await promise
  } finally {
    vi.useRealTimers()
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Runway Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RUNWAY_API_KEY = 'test-runway-key'
    process.env.RUNWAY_OUTPUT_DIR = './test-output/runway'

    // Restore mock implementations after clearAllMocks
    mockImageToVideoCreate.mockResolvedValue({ id: 'task-123' })
    mockTextToVideoCreate.mockResolvedValue({ id: 'task-123' })
    mockVideoToVideoCreate.mockResolvedValue({ id: 'task-123' })
    mockTasksRetrieve.mockResolvedValue({
      id: 'task-123',
      status: 'SUCCEEDED',
      output: ['https://example.com/video.mp4'],
      createdAt: '2024-01-01T00:00:00Z',
    })
    ;(fsPromises.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    ;(fsPromises.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      Buffer.from('fake-image-data')
    )
    ;(fsPromises.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(1024),
    })
  })

  afterEach(() => {
    delete process.env.RUNWAY_API_KEY
    delete process.env.RUNWAY_OUTPUT_DIR
    vi.useRealTimers()
  })

  // ─── imageToVideo ──────────────────────────────────────────────────────────

  describe('imageToVideo', () => {
    it('calls client.imageToVideo.create with correct model and prompt', async () => {
      const { imageToVideo } = await import('./runway.ts')

      await runWithFakeTimers(() => imageToVideo('/tmp/test.jpg', 'a cinematic shot', 5))

      expect(mockImageToVideoCreate).toHaveBeenCalledOnce()
      const callArgs = mockImageToVideoCreate.mock.calls[0][0] as Record<string, unknown>
      expect(callArgs.model).toBe('gen4_turbo')
      expect(callArgs.promptText).toBe('a cinematic shot')
      expect(callArgs.duration).toBe(5)
    })

    it('reads the image file and encodes to base64 data URL', async () => {
      const { imageToVideo } = await import('./runway.ts')

      await runWithFakeTimers(() => imageToVideo('/tmp/test.jpg', 'a sunset', 5))

      expect(fsPromises.readFile).toHaveBeenCalledWith('/tmp/test.jpg')

      const callArgs = mockImageToVideoCreate.mock.calls[0][0] as Record<string, unknown>
      const promptImage = callArgs.promptImage as string
      expect(promptImage).toMatch(/^data:image\/jpeg;base64,/)
      // Verify the base64 content matches our fake-image-data
      const expectedBase64 = Buffer.from('fake-image-data').toString('base64')
      expect(promptImage).toBe(`data:image/jpeg;base64,${expectedBase64}`)
    })

    it('detects mime type from .png extension', async () => {
      const { imageToVideo } = await import('./runway.ts')

      await runWithFakeTimers(() => imageToVideo('/tmp/photo.png', 'mountains', 10))

      const callArgs = mockImageToVideoCreate.mock.calls[0][0] as Record<string, unknown>
      expect((callArgs.promptImage as string)).toMatch(/^data:image\/png;base64,/)
    })

    it('detects mime type from .webp extension', async () => {
      const { imageToVideo } = await import('./runway.ts')

      await runWithFakeTimers(() => imageToVideo('/tmp/photo.webp', 'cityscape', 5))

      const callArgs = mockImageToVideoCreate.mock.calls[0][0] as Record<string, unknown>
      expect((callArgs.promptImage as string)).toMatch(/^data:image\/webp;base64,/)
    })

    it('polls client.tasks.retrieve until SUCCEEDED', async () => {
      const { imageToVideo } = await import('./runway.ts')

      await runWithFakeTimers(() => imageToVideo('/tmp/test.jpg', 'ocean waves', 5))

      expect(mockTasksRetrieve).toHaveBeenCalledWith('task-123')
    })

    it('downloads output URL and saves to output dir', async () => {
      const { imageToVideo } = await import('./runway.ts')

      const result = await runWithFakeTimers(() =>
        imageToVideo('/tmp/test.jpg', 'sunrise', 5)
      )

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('Expected ok result')

      expect(global.fetch).toHaveBeenCalledWith('https://example.com/video.mp4')
      expect(fsPromises.writeFile).toHaveBeenCalledOnce()
      expect(result.value).toMatch(/iv_\d+\.mp4$/)
      expect(result.value).toContain('test-output/runway')
    })

    it('returns { ok: false, error: "RUNWAY_API_KEY not set" } when key missing', async () => {
      delete process.env.RUNWAY_API_KEY
      const { imageToVideo } = await import('./runway.ts')

      const result = await imageToVideo('/tmp/test.jpg', 'forest', 5)

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected error result')
      expect(result.error).toBe('RUNWAY_API_KEY not set')
      expect(mockImageToVideoCreate).not.toHaveBeenCalled()
    })

    it('returns { ok: false } when task status is FAILED', async () => {
      mockTasksRetrieve.mockResolvedValue({
        id: 'task-123',
        status: 'FAILED',
        failure: 'content policy violation',
        createdAt: '2024-01-01T00:00:00Z',
      })

      const { imageToVideo } = await import('./runway.ts')

      const result = await runWithFakeTimers(() =>
        imageToVideo('/tmp/test.jpg', 'explicit content', 5)
      )

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected error result')
      expect(result.error).toBe('content policy violation')
    })

    it('returns { ok: false } with fallback error when FAILED task has no failure message', async () => {
      mockTasksRetrieve.mockResolvedValue({
        id: 'task-123',
        status: 'FAILED',
        failure: undefined,
        createdAt: '2024-01-01T00:00:00Z',
      })

      const { imageToVideo } = await import('./runway.ts')

      const result = await runWithFakeTimers(() =>
        imageToVideo('/tmp/test.jpg', 'something', 5)
      )

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected error result')
      expect(result.error).toBe('generation failed')
    })
  })

  // ─── textToVideo ──────────────────────────────────────────────────────────

  describe('textToVideo', () => {
    it('calls client.textToVideo.create with correct params', async () => {
      const { textToVideo } = await import('./runway.ts')

      await runWithFakeTimers(() => textToVideo('a futuristic city', 10))

      expect(mockTextToVideoCreate).toHaveBeenCalledOnce()
      const callArgs = mockTextToVideoCreate.mock.calls[0][0] as Record<string, unknown>
      expect(callArgs.model).toBe('gen4_turbo')
      expect(callArgs.promptText).toBe('a futuristic city')
      expect(callArgs.duration).toBe(10)
    })

    it('returns file path on success', async () => {
      const { textToVideo } = await import('./runway.ts')

      const result = await runWithFakeTimers(() => textToVideo('rolling hills', 5))

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('Expected ok result')
      expect(result.value).toMatch(/tv_\d+\.mp4$/)
      expect(result.value).toContain('test-output/runway')
    })

    it('returns { ok: false, error: "RUNWAY_API_KEY not set" } when key missing', async () => {
      delete process.env.RUNWAY_API_KEY
      const { textToVideo } = await import('./runway.ts')

      const result = await textToVideo('space exploration', 5)

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected error result')
      expect(result.error).toBe('RUNWAY_API_KEY not set')
    })

    it('polls tasks.retrieve and downloads output on success', async () => {
      const { textToVideo } = await import('./runway.ts')

      await runWithFakeTimers(() => textToVideo('abstract patterns', 5))

      expect(mockTasksRetrieve).toHaveBeenCalledWith('task-123')
      expect(global.fetch).toHaveBeenCalledWith('https://example.com/video.mp4')
    })
  })

  // ─── editVideo ────────────────────────────────────────────────────────────

  describe('editVideo', () => {
    it('reads video file and encodes it to base64 data URL', async () => {
      const { editVideo } = await import('./runway.ts')

      await runWithFakeTimers(() => editVideo('/tmp/source.mp4', 'make it look cinematic'))

      expect(fsPromises.readFile).toHaveBeenCalledWith('/tmp/source.mp4')

      const callArgs = mockVideoToVideoCreate.mock.calls[0][0] as Record<string, unknown>
      const promptVideo = callArgs.promptVideo as string
      expect(promptVideo).toMatch(/^data:video\/mp4;base64,/)
      const expectedBase64 = Buffer.from('fake-image-data').toString('base64')
      expect(promptVideo).toBe(`data:video/mp4;base64,${expectedBase64}`)
    })

    it('returns file path on success with ev_ prefix', async () => {
      const { editVideo } = await import('./runway.ts')

      const result = await runWithFakeTimers(() =>
        editVideo('/tmp/source.mp4', 'add lens flare')
      )

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('Expected ok result')
      expect(result.value).toMatch(/ev_\d+\.mp4$/)
      expect(result.value).toContain('test-output/runway')
    })

    it('returns { ok: false, error: "RUNWAY_API_KEY not set" } when key missing', async () => {
      delete process.env.RUNWAY_API_KEY
      const { editVideo } = await import('./runway.ts')

      const result = await editVideo('/tmp/source.mp4', 'slow motion')

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected error result')
      expect(result.error).toBe('RUNWAY_API_KEY not set')
    })
  })

  // ─── estimateCreditCost ───────────────────────────────────────────────────

  describe('estimateCreditCost', () => {
    it('returns durationSeconds * 5', async () => {
      const { estimateCreditCost } = await import('./runway.ts')

      expect(estimateCreditCost(5)).toBe(25)
      expect(estimateCreditCost(10)).toBe(50)
      expect(estimateCreditCost(1)).toBe(5)
      expect(estimateCreditCost(0)).toBe(0)
    })
  })
})
