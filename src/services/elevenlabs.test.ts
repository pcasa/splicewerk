import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fsPromises from 'node:fs/promises'

// ─── Mock fs/promises ────────────────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

// ─── Mock dotenv ─────────────────────────────────────────────────────────────

vi.mock('dotenv/config', () => ({}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockAudioBuffer = new ArrayBuffer(1024)

function mockFetchOk() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: async () => mockAudioBuffer,
  })
}

function mockFetchError(status: number) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    arrayBuffer: async () => new ArrayBuffer(0),
  })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ElevenLabs Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ELEVENLABS_API_KEY = 'test-api-key'
    process.env.ELEVENLABS_OUTPUT_DIR = './test-output/audio'
  })

  afterEach(() => {
    delete process.env.ELEVENLABS_API_KEY
    delete process.env.ELEVENLABS_OUTPUT_DIR
  })

  // ─── generateSFX ─────────────────────────────────────────────────────────

  describe('generateSFX', () => {
    it('sends POST to correct URL with correct body', async () => {
      mockFetchOk()
      const { generateSFX } = await import('./elevenlabs.ts')

      await generateSFX('explosion sound', 3)

      expect(global.fetch).toHaveBeenCalledOnce()
      const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.elevenlabs.io/v1/sound-generation')
      expect(options.method).toBe('POST')

      const body = JSON.parse(options.body as string)
      expect(body).toEqual({
        text: 'explosion sound',
        duration_seconds: 3,
        prompt_influence: 0.3,
      })
    })

    it('includes xi-api-key header', async () => {
      mockFetchOk()
      const { generateSFX } = await import('./elevenlabs.ts')

      await generateSFX('wind', 2)

      const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
      const headers = options.headers as Record<string, string>
      expect(headers['xi-api-key']).toBe('test-api-key')
    })

    it('saves file to output dir and returns file path', async () => {
      mockFetchOk()
      const { generateSFX } = await import('./elevenlabs.ts')

      const result = await generateSFX('rain', 5)

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('Expected ok result')

      expect(result.value).toMatch(/^(?:\.\/)?test-output\/audio\/sfx_\d+\.mp3$/)
      expect(fsPromises.mkdir).toHaveBeenCalledWith(expect.stringContaining('test-output/audio'), { recursive: true })
      expect(fsPromises.writeFile).toHaveBeenCalledOnce()

      const [writePath] = (fsPromises.writeFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
      expect(writePath).toBe(result.value)
    })

    it('returns { ok: false } on non-2xx response with status in error', async () => {
      mockFetchError(429)
      const { generateSFX } = await import('./elevenlabs.ts')

      const result = await generateSFX('fire crackle', 4)

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected error result')
      expect(result.error).toContain('429')
    })

    it('returns { ok: false, error: "ELEVENLABS_API_KEY not set" } when API key missing', async () => {
      delete process.env.ELEVENLABS_API_KEY
      mockFetchOk()
      const { generateSFX } = await import('./elevenlabs.ts')

      const result = await generateSFX('thunder', 2)

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected error result')
      expect(result.error).toBe('ELEVENLABS_API_KEY not set')
      expect(global.fetch).not.toHaveBeenCalled()
    })
  })

  // ─── generateTTS ─────────────────────────────────────────────────────────

  describe('generateTTS', () => {
    it('uses default voice ID when none provided', async () => {
      mockFetchOk()
      const { generateTTS } = await import('./elevenlabs.ts')

      await generateTTS('Hello world')

      const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
      expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM')
    })

    it('uses provided voice ID when given', async () => {
      mockFetchOk()
      const { generateTTS } = await import('./elevenlabs.ts')

      await generateTTS('Hello world', 'custom-voice-xyz')

      const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
      expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/custom-voice-xyz')
    })

    it('saves file to output dir with tts_ prefix and returns path', async () => {
      mockFetchOk()
      const { generateTTS } = await import('./elevenlabs.ts')

      const result = await generateTTS('Narrator speaks here')

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('Expected ok result')
      expect(result.value).toMatch(/^(?:\.\/)?test-output\/audio\/tts_\d+\.mp3$/)
    })
  })

  // ─── generateMusic ────────────────────────────────────────────────────────

  describe('generateMusic', () => {
    it('sends request to sound-generation endpoint', async () => {
      mockFetchOk()
      const { generateMusic } = await import('./elevenlabs.ts')

      await generateMusic('epic orchestral', 10)

      const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
      expect(url).toBe('https://api.elevenlabs.io/v1/sound-generation')
    })

    it('saves file with music_ prefix', async () => {
      mockFetchOk()
      const { generateMusic } = await import('./elevenlabs.ts')

      const result = await generateMusic('ambient drone', 15)

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('Expected ok result')
      expect(result.value).toMatch(/^(?:\.\/)?test-output\/audio\/music_\d+\.mp3$/)
    })
  })

  // ─── File write verification ──────────────────────────────────────────────

  describe('File write behavior', () => {
    it('calls fs.writeFile with correct path pattern for SFX', async () => {
      mockFetchOk()
      const { generateSFX } = await import('./elevenlabs.ts')

      const result = await generateSFX('beep', 1)
      expect(result.ok).toBe(true)

      expect(fsPromises.writeFile).toHaveBeenCalledOnce()
      const [writtenPath, writtenData] = (fsPromises.writeFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Buffer]
      expect(writtenPath).toMatch(/sfx_\d+\.mp3$/)
      expect(Buffer.isBuffer(writtenData)).toBe(true)
    })
  })
})
