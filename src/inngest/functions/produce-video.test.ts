import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Service Mocks (hoisted — no external variable refs) ───

vi.mock('../../services/asset-catalog.js', () => ({
  catalogAssets: vi.fn().mockResolvedValue({
    rootDir: '/assets',
    files: [
      {
        path: '/assets/clip1.mp4',
        filename: 'clip1.mp4',
        type: 'video',
        duration: 10,
        fileSize: 1024,
      },
    ],
    catalogedAt: '2026-03-21T00:00:00.000Z',
  }),
}))

vi.mock('../../services/llm.js', () => ({
  generateEDL: vi.fn(),
  validateVideoOutput: vi.fn().mockResolvedValue({
    ok: true,
    value: { verdict: 'pass', summary: 'Video matches description well.', issues: [] },
  }),
}))

vi.mock('../../services/ffmpeg.js', () => ({
  concatClips: vi.fn().mockResolvedValue({ ok: true, value: 'projects/test/rendered/master.mp4' }),
  mixAudio: vi.fn().mockResolvedValue({ ok: true, value: 'projects/test/rendered/master_mixed.mp4' }),
  reformat: vi.fn().mockResolvedValue({ ok: true, value: 'projects/test/output/youtube/output.mp4' }),
  trimClip: vi.fn().mockResolvedValue({ ok: true, value: 'projects/test/rendered/seg1.mp4' }),
  extractFrames: vi.fn().mockResolvedValue({ ok: true, value: ['frame_0001.jpg', 'frame_0002.jpg'] }),
  loadFormatPresets: vi.fn().mockReturnValue({
    youtube: { width: 1920, height: 1080, fps: 30 },
    'instagram-reels': { width: 1080, height: 1920, fps: 30 },
    tiktok: { width: 1080, height: 1920, fps: 30 },
  }),
}))

vi.mock('../../services/shotstack.js', () => ({
  uploadFile: vi.fn().mockResolvedValue({ ok: true, value: 'https://cdn.shotstack.io/test/seg1.mp4' }),
  assembleClips: vi.fn().mockResolvedValue({ ok: true, value: 'projects/test/output/youtube/output.mp4' }),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined),
  }
})

// ─── Import after mocks ───

import { produceVideo, produceVideoPipeline } from './produce-video.js'
import { catalogAssets } from '../../services/asset-catalog.js'
import { generateEDL, validateVideoOutput } from '../../services/llm.js'
import { concatClips, reformat, extractFrames } from '../../services/ffmpeg.js'
import { assembleClips } from '../../services/shotstack.js'

// ─── Fixtures (after imports) ───

const mockManifest = {
  rootDir: '/assets',
  files: [
    {
      path: '/assets/clip1.mp4',
      filename: 'clip1.mp4',
      type: 'video' as const,
      duration: 10,
      fileSize: 1024,
    },
  ],
  catalogedAt: '2026-03-21T00:00:00.000Z',
}

const mockEDL = {
  project: {
    title: 'Test Video',
    targetDurationSeconds: 60,
    aspectRatio: '16:9',
    resolution: '1920x1080',
    outputFormats: ['youtube'],
  },
  missingAssets: [],
  timeline: [
    {
      id: 'seg1',
      type: 'clip' as const,
      processor: 'ffmpeg' as const,
      source: '/assets/clip1.mp4',
      trim: '0-10',
    },
  ],
  audio: {
    backgroundMusic: {
      source: '/assets/music.mp3',
      volume: 0.3,
      fadeIn: 2,
      fadeOut: 2,
    },
  },
  thumbnail: {
    type: 'split',
    style: 'before-after',
  },
}

// ─── Helpers ───

function createMockStep() {
  return {
    run: vi.fn().mockImplementation((_name: string, fn: () => unknown) => fn()),
    waitForEvent: vi.fn(),
    sleep: vi.fn().mockResolvedValue(undefined),
  } as unknown as Parameters<typeof produceVideoPipeline>[1]
}

type EventData = {
  prompt: string
  assetsDir: string
  formats: string[]
  projectName: string
  dryRun?: boolean
}

function createMockEvent(overrides: Partial<EventData> = {}) {
  return {
    name: 'video/production-requested' as const,
    data: {
      prompt: 'Create a product demo video',
      assetsDir: '/assets',
      formats: ['youtube'],
      projectName: 'test',
      dryRun: false,
      ...overrides,
    },
  }
}

// ─── Tests ───

describe('produceVideo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Re-apply defaults after clearAllMocks
    vi.mocked(catalogAssets).mockResolvedValue(mockManifest)
    vi.mocked(generateEDL).mockResolvedValue({ ok: true, value: mockEDL })
    vi.mocked(concatClips).mockResolvedValue({ ok: true, value: 'projects/test/rendered/master.mp4' })
    vi.mocked(reformat).mockResolvedValue({ ok: true, value: 'projects/test/output/youtube/output.mp4' })
    vi.mocked(extractFrames).mockResolvedValue({ ok: true, value: ['frame_0001.jpg', 'frame_0002.jpg'] })
    vi.mocked(validateVideoOutput).mockResolvedValue({
      ok: true,
      value: { verdict: 'pass', summary: 'Looks good.', issues: [] },
    })
  })

  it('is exported and has correct id and event trigger', () => {
    expect(produceVideo).toBeDefined()
    expect(typeof produceVideo).toBe('object')
    // In Inngest v4, id() is a method on the function object
    const fn = produceVideo as unknown as { id: (prefix?: string) => string; opts: { id: string } }
    expect(fn.opts.id).toBe('produce-video')
  })

  it('calls catalogAssets with the assetsDir from the event', async () => {
    const mockStep = createMockStep()
    const mockEvent = createMockEvent({ assetsDir: '/my/assets' })

    await produceVideoPipeline(mockEvent, mockStep)

    expect(catalogAssets).toHaveBeenCalledWith('/my/assets')
  })

  it('calls generateEDL with the prompt and manifest', async () => {
    const mockStep = createMockStep()
    const mockEvent = createMockEvent({ prompt: 'Make a great video' })

    await produceVideoPipeline(mockEvent, mockStep)

    expect(generateEDL).toHaveBeenCalledWith('Make a great video', mockManifest)
  })

  it('throws when EDL is missing project field', async () => {
    vi.mocked(generateEDL).mockResolvedValueOnce({
      ok: true,
      value: { ...mockEDL, project: undefined as unknown as typeof mockEDL.project },
    })

    const mockStep = createMockStep()
    const mockEvent = createMockEvent()

    await expect(produceVideoPipeline(mockEvent, mockStep)).rejects.toThrow(
      'Invalid EDL: missing required field "project"'
    )
  })

  it('returns EDL without calling concatClips when dryRun is true', async () => {
    const mockStep = createMockStep()
    const mockEvent = createMockEvent({ dryRun: true })

    const result = await produceVideoPipeline(mockEvent, mockStep)

    expect(result.dryRun).toBe(true)
    expect(result.edl).toEqual(mockEDL)
    expect(result.masterPath).toBeNull()
    expect(result.outputs).toEqual([])
    expect(concatClips).not.toHaveBeenCalled()
  })

  it('calls assembleClips once per requested format', async () => {
    const mockStep = createMockStep()
    const mockEvent = createMockEvent({ formats: ['youtube', 'instagram-reels', 'tiktok'] })

    vi.mocked(assembleClips)
      .mockResolvedValueOnce({ ok: true, value: 'output/youtube/output.mp4' })
      .mockResolvedValueOnce({ ok: true, value: 'output/instagram-reels/output.mp4' })
      .mockResolvedValueOnce({ ok: true, value: 'output/tiktok/output.mp4' })

    await produceVideoPipeline(mockEvent, mockStep)

    expect(assembleClips).toHaveBeenCalledTimes(3)
    expect(assembleClips).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringContaining('youtube'),
      expect.objectContaining({ width: 1920, height: 1080 })
    )
    expect(assembleClips).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringContaining('instagram-reels'),
      expect.objectContaining({ width: 1080, height: 1920 })
    )
    expect(assembleClips).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringContaining('tiktok'),
      expect.objectContaining({ width: 1080, height: 1920 })
    )
  })

  it('returns object with projectName, edl, masterPath, and outputs', async () => {
    const mockStep = createMockStep()
    const mockEvent = createMockEvent({ projectName: 'my-project', formats: ['youtube'] })

    const result = await produceVideoPipeline(mockEvent, mockStep)

    expect(result.projectName).toBe('my-project')
    expect(result.edl).toEqual(mockEDL)
    expect(result.masterPath).toBeNull()
    expect(Array.isArray(result.outputs)).toBe(true)
    expect(result.outputs.length).toBe(1)
    expect(result.dryRun).toBe(false)
  })

  it('runs Step 10 validation and includes result in return value', async () => {
    const mockStep = createMockStep()
    const mockEvent = createMockEvent({ prompt: 'Cinematic car reveal', projectName: 'my-project' })

    const result = await produceVideoPipeline(mockEvent, mockStep)

    expect(extractFrames).toHaveBeenCalledWith(
      expect.stringContaining('output.mp4'),
      2,
      expect.stringContaining('validation-frames')
    )
    expect(validateVideoOutput).toHaveBeenCalledWith(
      ['frame_0001.jpg', 'frame_0002.jpg'],
      'Cinematic car reveal'
    )
    expect(result.validation).toEqual({ verdict: 'pass', summary: 'Looks good.', issues: [] })
  })

  it('returns null validation and continues when frame extraction fails', async () => {
    vi.mocked(extractFrames).mockResolvedValueOnce({ ok: false, error: 'ffmpeg not found' })
    const mockStep = createMockStep()
    const result = await produceVideoPipeline(createMockEvent(), mockStep)
    expect(result.validation).toBeNull()
    expect(validateVideoOutput).not.toHaveBeenCalled()
  })
})
