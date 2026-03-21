import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import type { AssetManifest } from '../edl/types.js'

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockSend = vi.fn().mockResolvedValue(undefined)

vi.mock('inngest', () => {
  function MockInngest() {
    return { send: mockSend }
  }
  return { Inngest: MockInngest }
})

vi.mock('../services/asset-catalog.js', () => ({
  catalogAssets: vi.fn().mockResolvedValue({
    rootDir: '/test',
    files: [],
    catalogedAt: '2024-01-01T00:00:00.000Z',
  } satisfies AssetManifest),
}))

vi.mock('../services/ffmpeg.js', () => ({
  loadFormatPresets: vi.fn().mockReturnValue({
    youtube: {
      label: 'YouTube (16:9)',
      width: 1920,
      height: 1080,
      fps: 30,
      aspectRatio: '16:9',
      codec: 'h264',
      crf: 23,
      maxBitrate: '8M',
      audioBitrate: '128k',
      pixelFormat: 'yuv420p',
      container: 'mp4',
      maxDuration: null,
      cropStrategy: 'center',
    },
    'instagram-reels': {
      label: 'Instagram Reels (9:16)',
      width: 1080,
      height: 1920,
      fps: 30,
      aspectRatio: '9:16',
      codec: 'h264',
      crf: 23,
      maxBitrate: '8M',
      audioBitrate: '128k',
      pixelFormat: 'yuv420p',
      container: 'mp4',
      maxDuration: 90,
      cropStrategy: 'smart',
    },
  }),
}))

// ─── Import handlers after mocks are set up ───────────────────────────────────

import { catalogAssets } from '../services/asset-catalog.js'
import { loadFormatPresets } from '../services/ffmpeg.js'

const catalogAssetsMock = catalogAssets as Mock
const loadFormatPresetsMock = loadFormatPresets as Mock

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CLI handlers', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let processExitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as () => never)
    vi.clearAllMocks()
    // Re-setup mockSend after clearAllMocks
    mockSend.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ─── handleCatalog ────────────────────────────────────────────────────────

  describe('handleCatalog', () => {
    it('calls catalogAssets with the provided path and prints JSON output', async () => {
      const { handleCatalog } = await import('./index.js')

      catalogAssetsMock.mockResolvedValueOnce({
        rootDir: '/my/assets',
        files: [],
        catalogedAt: '2024-01-01T00:00:00.000Z',
      })

      await handleCatalog('/my/assets')

      expect(catalogAssetsMock).toHaveBeenCalledWith('/my/assets')
      expect(consoleLogSpy).toHaveBeenCalledWith(
        JSON.stringify(
          { rootDir: '/my/assets', files: [], catalogedAt: '2024-01-01T00:00:00.000Z' },
          null,
          2
        )
      )
    })

    it('exits with code 1 on error', async () => {
      const { handleCatalog } = await import('./index.js')

      catalogAssetsMock.mockRejectedValueOnce(new Error('Directory not found'))

      await handleCatalog('/nonexistent')

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error cataloging assets:'),
        'Directory not found'
      )
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })
  })

  // ─── handleFormats ────────────────────────────────────────────────────────

  describe('handleFormats', () => {
    it('calls loadFormatPresets and prints format info', async () => {
      const { handleFormats } = await import('./index.js')

      handleFormats()

      expect(loadFormatPresetsMock).toHaveBeenCalled()
      // Check that header row was printed
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('NAME'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('DIMENSIONS'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('FPS'))
      // Check that youtube row was printed
      const allCalls = consoleLogSpy.mock.calls.map((args) => args.join(' '))
      expect(allCalls.some((line) => line.includes('youtube'))).toBe(true)
      expect(allCalls.some((line) => line.includes('1920x1080'))).toBe(true)
    })

    it('prints unlimited for formats with no max duration', async () => {
      const { handleFormats } = await import('./index.js')

      handleFormats()

      const allCalls = consoleLogSpy.mock.calls.map((args) => args.join(' '))
      // youtube has maxDuration: null → should print 'unlimited'
      expect(allCalls.some((line) => line.includes('unlimited'))).toBe(true)
      // instagram-reels has maxDuration: 90 → should print '90s'
      expect(allCalls.some((line) => line.includes('90s'))).toBe(true)
    })
  })

  // ─── handleProduce ────────────────────────────────────────────────────────

  describe('handleProduce', () => {
    it('sends an Inngest event with correct shape', async () => {
      const { handleProduce } = await import('./index.js')

      await handleProduce({
        prompt: 'Make a highlight reel',
        assets: '/my/assets',
        formats: 'youtube',
        project: 'my-project',
        dryRun: false,
      })

      expect(mockSend).toHaveBeenCalledWith({
        name: 'video/production-requested',
        data: {
          prompt: 'Make a highlight reel',
          assetsDir: '/my/assets',
          formats: ['youtube'],
          projectName: 'my-project',
          dryRun: false,
        },
      })
    })

    it('splits formats string into array correctly', async () => {
      const { handleProduce } = await import('./index.js')

      await handleProduce({
        prompt: 'Multi-format video',
        assets: '/my/assets',
        formats: 'youtube,instagram-reels',
        project: 'test-project',
        dryRun: false,
      })

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            formats: ['youtube', 'instagram-reels'],
          }),
        })
      )
    })

    it('uses assets dir basename as default project name', async () => {
      const { handleProduce } = await import('./index.js')

      await handleProduce({
        prompt: 'Test video',
        assets: '/my/project-assets',
        formats: 'youtube',
        dryRun: false,
      })

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectName: 'project-assets',
          }),
        })
      )
    })

    it('prints confirmation message after queueing', async () => {
      const { handleProduce } = await import('./index.js')

      await handleProduce({
        prompt: 'Test',
        assets: '/my/project-assets',
        formats: 'youtube',
        project: 'my-project',
        dryRun: false,
      })

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Production job queued for project: my-project')
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Formats: youtube'))
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Run 'pnpm inngest:dev'")
      )
    })

    it('exits with code 1 on Inngest send error', async () => {
      const { handleProduce } = await import('./index.js')

      mockSend.mockRejectedValueOnce(new Error('Network error'))

      await handleProduce({
        prompt: 'Test',
        assets: '/my/assets',
        formats: 'youtube',
        project: 'test-project',
        dryRun: false,
      })

      expect(processExitSpy).toHaveBeenCalledWith(1)
    })
  })

  // ─── handleStatus ─────────────────────────────────────────────────────────

  describe('handleStatus', () => {
    it('prints the dashboard URL with project name', async () => {
      const { handleStatus } = await import('./index.js')

      handleStatus('my-project')

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Status check for project 'my-project'")
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('http://localhost:8288')
      )
    })
  })
})
