import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import YAML from 'yaml'
import {
  loadChannelConfig,
  loadMusicLibrary,
  selectMusic,
  getTextStyle,
  getThumbnailStyle,
  type MusicTrack,
  type ChannelConfig,
} from './channel.js'

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const validConfigYaml = `
channel:
  name: "Test Channel"
branding:
  colors:
    primary: "#FF0000"
    secondary: "#000000"
    accent: "#FFFFFF"
  fonts:
    heading: "Arial Bold"
    body: "Arial"
defaults:
  targetDurationSeconds: 30
  outputFormats: ["youtube"]
  aspectRatio: "16:9"
  resolution: "1920x1080"
intro:
  enabled: true
  durationSeconds: 3
  template: "logo_reveal"
outro:
  enabled: true
  durationSeconds: 5
  template: "subscribe_cta"
textStyles:
  title:
    fontSize: 72
    fontColor: "#FFFFFF"
    background: false
thumbnailStyles:
  default:
    style: "singleFrame"
`

const mockTracks: MusicTrack[] = [
  {
    path: 'music/track1.mp3',
    title: 'Track 1',
    mood: ['energetic'],
    energy: 'high',
    genre: 'rock',
    durationSeconds: 180,
  },
  {
    path: 'music/track2.mp3',
    title: 'Track 2',
    mood: ['calm'],
    energy: 'low',
    genre: 'ambient',
    durationSeconds: 240,
  },
]

// ─── loadChannelConfig ────────────────────────────────────────────────────────

describe('loadChannelConfig', () => {
  beforeEach(() => {
    vi.mocked(fs.readFileSync).mockReset()
  })

  it('returns ok:true with valid config', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(validConfigYaml)

    const result = loadChannelConfig('/fake/path/channel.yaml')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.channel.name).toBe('Test Channel')
      expect(result.value.branding.colors.primary).toBe('#FF0000')
      expect(result.value.defaults.outputFormats).toEqual(['youtube'])
    }
  })

  it('returns ok:false when file not found', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory')
    })

    const result = loadChannelConfig('/nonexistent/path.yaml')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Failed to read config file')
    }
  })

  it('returns ok:false when channel.name is missing', () => {
    const yaml = `
channel:
  tagline: "Some tagline"
branding:
  colors:
    primary: "#FF0000"
    secondary: "#000000"
    accent: "#FFFFFF"
  fonts:
    heading: "Arial Bold"
    body: "Arial"
defaults:
  targetDurationSeconds: 30
  outputFormats: ["youtube"]
  aspectRatio: "16:9"
  resolution: "1920x1080"
intro:
  enabled: true
  durationSeconds: 3
  template: "logo_reveal"
outro:
  enabled: true
  durationSeconds: 5
  template: "subscribe_cta"
textStyles: {}
thumbnailStyles: {}
`
    vi.mocked(fs.readFileSync).mockReturnValue(yaml)

    const result = loadChannelConfig('/fake/path.yaml')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('channel.name')
    }
  })

  it('returns ok:false when branding.colors is missing', () => {
    const yaml = `
channel:
  name: "Test Channel"
branding:
  fonts:
    heading: "Arial Bold"
    body: "Arial"
defaults:
  targetDurationSeconds: 30
  outputFormats: ["youtube"]
  aspectRatio: "16:9"
  resolution: "1920x1080"
intro:
  enabled: true
  durationSeconds: 3
  template: "logo_reveal"
outro:
  enabled: true
  durationSeconds: 5
  template: "subscribe_cta"
textStyles: {}
thumbnailStyles: {}
`
    vi.mocked(fs.readFileSync).mockReturnValue(yaml)

    const result = loadChannelConfig('/fake/path.yaml')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('branding.colors')
    }
  })

  it('returns ok:false when defaults.outputFormats is empty array', () => {
    const yaml = `
channel:
  name: "Test Channel"
branding:
  colors:
    primary: "#FF0000"
    secondary: "#000000"
    accent: "#FFFFFF"
  fonts:
    heading: "Arial Bold"
    body: "Arial"
defaults:
  targetDurationSeconds: 30
  outputFormats: []
  aspectRatio: "16:9"
  resolution: "1920x1080"
intro:
  enabled: true
  durationSeconds: 3
  template: "logo_reveal"
outro:
  enabled: true
  durationSeconds: 5
  template: "subscribe_cta"
textStyles: {}
thumbnailStyles: {}
`
    vi.mocked(fs.readFileSync).mockReturnValue(yaml)

    const result = loadChannelConfig('/fake/path.yaml')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('defaults.outputFormats')
    }
  })
})

// ─── loadMusicLibrary ─────────────────────────────────────────────────────────

describe('loadMusicLibrary', () => {
  beforeEach(() => {
    vi.mocked(fs.readFileSync).mockReset()
  })

  it('returns ok:true with empty tracks array', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('tracks: []')

    const result = loadMusicLibrary('/fake/music-library.yaml')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.tracks).toEqual([])
    }
  })

  it('returns ok:false when tracks is not an array', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('tracks: "not an array"')

    const result = loadMusicLibrary('/fake/music-library.yaml')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('tracks must be an array')
    }
  })
})

// ─── selectMusic ──────────────────────────────────────────────────────────────

describe('selectMusic', () => {
  it('returns a track matching the requested mood', () => {
    const library = { tracks: mockTracks }
    const result = selectMusic(library, 'energetic')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.mood).toContain('energetic')
    }
  })

  it('returns a track matching the requested energy', () => {
    const library = { tracks: mockTracks }
    const result = selectMusic(library, undefined, 'low')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.energy).toBe('low')
    }
  })

  it('returns a track with durationSeconds >= minDuration', () => {
    const library = { tracks: mockTracks }
    const result = selectMusic(library, undefined, undefined, 200)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.durationSeconds).toBeGreaterThanOrEqual(200)
    }
  })

  it('falls back when no exact match and returns any track rather than error', () => {
    const library = { tracks: mockTracks }
    // Request mood that doesn't exist - should fall back and return a track
    const result = selectMusic(library, 'nonexistent-mood', 'medium')

    expect(result.ok).toBe(true)
  })

  it('returns ok:false when library has no tracks', () => {
    const library = { tracks: [] }
    const result = selectMusic(library, 'energetic')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('No tracks in music library')
    }
  })
})

// ─── getTextStyle ─────────────────────────────────────────────────────────────

describe('getTextStyle', () => {
  const config = YAML.parse(validConfigYaml) as ChannelConfig

  it('returns the correct style for a known name', () => {
    const style = getTextStyle(config, 'title')

    expect(style.fontSize).toBe(72)
    expect(style.fontColor).toBe('#FFFFFF')
  })

  it('falls back to title style for unknown name', () => {
    const style = getTextStyle(config, 'nonexistent-style')

    // Should fall back to title style
    expect(style.fontSize).toBe(72)
    expect(style.fontColor).toBe('#FFFFFF')
  })
})

// ─── getThumbnailStyle ────────────────────────────────────────────────────────

describe('getThumbnailStyle', () => {
  const config = YAML.parse(validConfigYaml) as ChannelConfig

  it('returns the correct style for a known name', () => {
    const style = getThumbnailStyle(config, 'default')

    expect(style.style).toBe('singleFrame')
  })

  it('falls back to default style for unknown name', () => {
    const style = getThumbnailStyle(config, 'nonexistent-style')

    expect(style.style).toBe('singleFrame')
  })
})
