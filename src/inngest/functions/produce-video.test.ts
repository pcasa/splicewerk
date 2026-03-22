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
  generateEDL: vi.fn().mockResolvedValue({
    ok: true,
    value: {
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
          type: 'clip',
          processor: 'ffmpeg',
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
    },
  }),
}))

vi.mock('../../services/ffmpeg.js', () => ({
  concatClips: vi.fn().mockResolvedValue({ ok: true, value: 'projects/test/rendered/master.mp4' }),
  mixAudio: vi.fn().mockResolvedValue({ ok: true, value: 'projects/test/rendered/master_mixed.mp4' }),
  reformat: vi.fn().mockResolvedValue({ ok: true, value: 'projects/test/output/youtube/output.mp4' }),
  trimClip: vi.fn().mockResolvedValue({ ok: true, value: 'projects/test/rendered/seg1.mp4' }),
}))

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
}))

// ─── Import after mocks ───

import { produceVideo, produceVideoPipeline } from './produce-video.js'
import { catalogAssets } from '../../services/asset-catalog.js'
import { generateEDL } from '../../services/llm.js'
import { concatClips, reformat } from '../../services/ffmpeg.js'

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

type StepMock = {
  run: ReturnType<typeof vi.fn>
  waitForEvent: ReturnType<typeof vi.fn>
}

function createMockStep(): StepMock {
  return {
    run: vi.fn().mockImplementation((_name: string, fn: () => unknown) => fn()),
    waitForEvent: vi.fn(),
  }
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

    await produceVideoPipeline(mockEvent, mockStep, 'test-run-id')

    expect(catalogAssets).toHaveBeenCalledWith('/my/assets')
  })

  it('calls generateEDL with the prompt and manifest', async () => {
    const mockStep = createMockStep()
    const mockEvent = createMockEvent({ prompt: 'Make a great video' })

    await produceVideoPipeline(mockEvent, mockStep, 'test-run-id')

    expect(generateEDL).toHaveBeenCalledWith('Make a great video', mockManifest)
  })

  it('throws when EDL is missing project field', async () => {
    vi.mocked(generateEDL).mockResolvedValueOnce({
      ok: true,
      value: { ...mockEDL, project: undefined as unknown as typeof mockEDL.project },
    })

    const mockStep = createMockStep()
    const mockEvent = createMockEvent()

    await expect(produceVideoPipeline(mockEvent, mockStep, 'test-run-id')).rejects.toThrow(
      'Invalid EDL: missing required field "project"'
    )
  })

  it('returns EDL without calling concatClips when dryRun is true', async () => {
    const mockStep = createMockStep()
    const mockEvent = createMockEvent({ dryRun: true })

    const result = await produceVideoPipeline(mockEvent, mockStep, 'test-run-id')

    expect(result.dryRun).toBe(true)
    expect(result.edl).toEqual(mockEDL)
    expect(result.masterPath).toBeNull()
    expect(result.outputs).toEqual([])
    expect(concatClips).not.toHaveBeenCalled()
  })

  it('calls reformat once per requested format', async () => {
    const mockStep = createMockStep()
    const mockEvent = createMockEvent({ formats: ['youtube', 'instagram-reels', 'tiktok'] })

    vi.mocked(reformat)
      .mockResolvedValueOnce({ ok: true, value: 'output/youtube/output.mp4' })
      .mockResolvedValueOnce({ ok: true, value: 'output/instagram-reels/output.mp4' })
      .mockResolvedValueOnce({ ok: true, value: 'output/tiktok/output.mp4' })

    await produceVideoPipeline(mockEvent, mockStep, 'test-run-id')

    expect(reformat).toHaveBeenCalledTimes(3)
    expect(reformat).toHaveBeenCalledWith(
      expect.any(String),
      'youtube',
      expect.stringContaining('youtube')
    )
    expect(reformat).toHaveBeenCalledWith(
      expect.any(String),
      'instagram-reels',
      expect.stringContaining('instagram-reels')
    )
    expect(reformat).toHaveBeenCalledWith(
      expect.any(String),
      'tiktok',
      expect.stringContaining('tiktok')
    )
  })

  it('returns object with projectName, edl, masterPath, and outputs', async () => {
    const mockStep = createMockStep()
    const mockEvent = createMockEvent({ projectName: 'my-project', formats: ['youtube'] })

    const result = await produceVideoPipeline(mockEvent, mockStep, 'test-run-id')

    expect(result.projectName).toBe('my-project')
    expect(result.edl).toEqual(mockEDL)
    expect(result.masterPath).toBeTruthy()
    expect(Array.isArray(result.outputs)).toBe(true)
    expect(result.outputs.length).toBe(1)
    expect(result.dryRun).toBe(false)
  })
})
