import 'dotenv/config'
import * as fs from 'node:fs'
import * as path from 'node:path'
import YAML from 'yaml'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TextStyle {
  fontSize: number
  fontColor: string
  background: boolean
  backgroundColor?: string
}

export interface ThumbnailStyle {
  style: 'singleFrame' | 'beforeAfterSplit' | 'collage'
  textPosition?: string
  overlayOpacity?: number
  leftLabel?: string
  rightLabel?: string
}

export interface ChannelBranding {
  colors: { primary: string; secondary: string; accent: string }
  fonts: { heading: string; body: string }
  logo?: string
  watermark?: string
}

export interface ChannelDefaults {
  targetDurationSeconds: number
  outputFormats: string[]
  aspectRatio: string
  resolution: string
}

export interface ChannelConfig {
  channel: { name: string; tagline?: string }
  branding: ChannelBranding
  defaults: ChannelDefaults
  intro: { enabled: boolean; durationSeconds: number; template: string }
  outro: { enabled: boolean; durationSeconds: number; template: string }
  textStyles: Record<string, TextStyle>
  thumbnailStyles: Record<string, ThumbnailStyle>
}

export interface MusicTrack {
  path: string
  title: string
  mood: string[]
  energy: 'low' | 'medium' | 'high'
  genre: string
  durationSeconds: number
  bpm?: number
  tags?: string[]
}

export interface MusicLibrary {
  tracks: MusicTrack[]
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

// ─── Config Loaders ──────────────────────────────────────────────────────────

export function loadChannelConfig(configPath?: string): Result<ChannelConfig> {
  const resolvedPath = configPath ?? (process.env['CHANNEL_CONFIG_PATH'] ?? './src/config/channel.yaml')

  let raw: string
  try {
    raw = fs.readFileSync(resolvedPath, 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to read config file: ${message}` }
  }

  let config: unknown
  try {
    config = YAML.parse(raw)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to parse config YAML: ${message}` }
  }

  // Validate required fields
  if (
    !config ||
    typeof config !== 'object' ||
    !('channel' in config) ||
    !(config as Record<string, unknown>)['channel'] ||
    typeof (config as Record<string, unknown>)['channel'] !== 'object'
  ) {
    return { ok: false, error: 'Missing required field: channel' }
  }

  const cfg = config as Record<string, unknown>
  const channel = cfg['channel'] as Record<string, unknown>

  if (!channel['name'] || typeof channel['name'] !== 'string') {
    return { ok: false, error: 'Missing required field: channel.name' }
  }

  if (!cfg['branding'] || typeof cfg['branding'] !== 'object') {
    return { ok: false, error: 'Missing required field: branding' }
  }

  const branding = cfg['branding'] as Record<string, unknown>

  if (!branding['colors'] || typeof branding['colors'] !== 'object') {
    return { ok: false, error: 'Missing required field: branding.colors' }
  }

  const colors = branding['colors'] as Record<string, unknown>
  if (!colors['primary'] || !colors['secondary'] || !colors['accent']) {
    return { ok: false, error: 'Missing required field: branding.colors' }
  }

  if (!branding['fonts'] || typeof branding['fonts'] !== 'object') {
    return { ok: false, error: 'Missing required field: branding.fonts' }
  }

  const fonts = branding['fonts'] as Record<string, unknown>
  if (!fonts['heading'] || !fonts['body']) {
    return { ok: false, error: 'Missing required field: branding.fonts' }
  }

  if (!cfg['defaults'] || typeof cfg['defaults'] !== 'object') {
    return { ok: false, error: 'Missing required field: defaults' }
  }

  const defaults = cfg['defaults'] as Record<string, unknown>
  if (
    !Array.isArray(defaults['outputFormats']) ||
    (defaults['outputFormats'] as unknown[]).length === 0
  ) {
    return { ok: false, error: 'Missing required field: defaults.outputFormats' }
  }

  return { ok: true, value: config as ChannelConfig }
}

export function loadMusicLibrary(libraryPath?: string): Result<MusicLibrary> {
  const resolvedPath = libraryPath ?? (process.env['MUSIC_LIBRARY_PATH'] ?? './src/config/music-library.yaml')

  let raw: string
  try {
    raw = fs.readFileSync(resolvedPath, 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to read music library file: ${message}` }
  }

  let parsed: unknown
  try {
    parsed = YAML.parse(raw)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to parse music library YAML: ${message}` }
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('tracks' in parsed) ||
    !Array.isArray((parsed as Record<string, unknown>)['tracks'])
  ) {
    return { ok: false, error: 'Invalid music library: tracks must be an array' }
  }

  const tracks = (parsed as Record<string, unknown>)['tracks'] as MusicTrack[]

  return { ok: true, value: { tracks } }
}

// ─── Music Selection ──────────────────────────────────────────────────────────

export function selectMusic(
  library: MusicLibrary,
  mood?: string,
  energy?: 'low' | 'medium' | 'high',
  minDurationSeconds?: number
): Result<MusicTrack> {
  if (library.tracks.length === 0) {
    return { ok: false, error: 'No tracks in music library' }
  }

  // Full match: all provided criteria
  let candidates = library.tracks.filter((track) => {
    if (mood !== undefined && !track.mood.includes(mood)) return false
    if (energy !== undefined && track.energy !== energy) return false
    if (minDurationSeconds !== undefined && track.durationSeconds < minDurationSeconds) return false
    return true
  })

  if (candidates.length > 0) {
    return { ok: true, value: candidates[Math.floor(Math.random() * candidates.length)]! }
  }

  // Widen: try only energy
  if (energy !== undefined) {
    candidates = library.tracks.filter((track) => track.energy === energy)
    if (candidates.length > 0) {
      return { ok: true, value: candidates[Math.floor(Math.random() * candidates.length)]! }
    }
  }

  // Widen: try only mood
  if (mood !== undefined) {
    candidates = library.tracks.filter((track) => track.mood.includes(mood))
    if (candidates.length > 0) {
      return { ok: true, value: candidates[Math.floor(Math.random() * candidates.length)]! }
    }
  }

  // Last resort: return first track
  if (library.tracks.length > 0) {
    return { ok: true, value: library.tracks[0]! }
  }

  return { ok: false, error: 'No matching track found' }
}

// ─── Style Lookups ────────────────────────────────────────────────────────────

export function getTextStyle(config: ChannelConfig, styleName: string): TextStyle {
  return config.textStyles[styleName] ?? config.textStyles['title'] ?? {
    fontSize: 72,
    fontColor: '#FFFFFF',
    background: false,
  }
}

export function getThumbnailStyle(config: ChannelConfig, styleName: string): ThumbnailStyle {
  return config.thumbnailStyles[styleName] ?? config.thumbnailStyles['default'] ?? {
    style: 'singleFrame',
  }
}
