import { describe, it, expect } from 'vitest'
import { validateEDL } from './validator.js'
import type { AssetManifest, EDL } from './types.js'

// ─── Fixtures ───

const testManifest: AssetManifest = {
  rootDir: '/assets',
  files: [
    { path: '/assets/clip1.mp4', filename: 'clip1.mp4', type: 'video', fileSize: 1000000 },
    { path: '/assets/music.mp3', filename: 'music.mp3', type: 'audio', fileSize: 500000 },
  ],
  catalogedAt: '2024-01-01T00:00:00Z',
}

const validEDL: EDL = {
  project: {
    title: 'Test',
    targetDurationSeconds: 15,
    aspectRatio: '16:9',
    resolution: '1920x1080',
    outputFormats: ['youtube'],
  },
  missingAssets: [],
  timeline: [
    { id: 'seg1', type: 'clip', processor: 'ffmpeg', source: 'clip1.mp4', durationSeconds: 5 },
    { id: 'seg2', type: 'generated', processor: 'runway', prompt: 'dramatic intro', durationSeconds: 3 },
  ],
  audio: { backgroundMusic: { source: 'music.mp3', volume: 0.3, fadeIn: 1, fadeOut: 2 } },
  thumbnail: { type: 'single', style: 'default' },
}

// ─── Tests ───

describe('validateEDL', () => {
  it('returns valid: true for a well-formed EDL with all assets present in manifest', () => {
    const result = validateEDL(validEDL, testManifest)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('returns valid: false when edl.project is missing', () => {
    const edl = { ...validEDL, project: undefined }
    const result = validateEDL(edl, testManifest)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.field === 'project')).toBe(true)
  })

  it('returns valid: false when timeline is empty array', () => {
    const edl: EDL = { ...validEDL, timeline: [] }
    const result = validateEDL(edl, testManifest)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.field === 'timeline')).toBe(true)
  })

  it('returns valid: false when a segment references a file not in manifest', () => {
    const edl: EDL = {
      ...validEDL,
      timeline: [
        { id: 'seg1', type: 'clip', processor: 'ffmpeg', source: 'missing_file.mp4', durationSeconds: 5 },
      ],
    }
    const result = validateEDL(edl, testManifest)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.message.includes('missing_file.mp4'))).toBe(true)
  })

  it('returns valid: false when a segment has invalid processor value', () => {
    const edl = {
      ...validEDL,
      timeline: [
        { id: 'seg1', type: 'clip', processor: 'invalid_processor', source: 'clip1.mp4', durationSeconds: 5 },
      ],
    }
    const result = validateEDL(edl as unknown as EDL, testManifest)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.field.includes('processor'))).toBe(true)
  })

  it('returns valid: false when targetDurationSeconds is 0', () => {
    const edl: EDL = {
      ...validEDL,
      project: { ...validEDL.project, targetDurationSeconds: 0 },
    }
    const result = validateEDL(edl, testManifest)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.field === 'project.targetDurationSeconds')).toBe(true)
  })

  it('returns valid: true with a warning when targetDurationSeconds > 120', () => {
    const edl: EDL = {
      ...validEDL,
      project: { ...validEDL.project, targetDurationSeconds: 200 },
    }
    const result = validateEDL(edl, testManifest)
    expect(result.valid).toBe(true)
    expect(result.warnings.some(w => w.message.includes('unusually long video'))).toBe(true)
  })

  it('returns valid: true with a warning for unrecognized output format', () => {
    const edl: EDL = {
      ...validEDL,
      project: { ...validEDL.project, outputFormats: ['youtube', 'unknown-platform'] },
    }
    const result = validateEDL(edl, testManifest)
    expect(result.valid).toBe(true)
    expect(result.warnings.some(w => w.message.includes('unknown-platform'))).toBe(true)
  })

  it('returns valid: false when edl is null', () => {
    const result = validateEDL(null, testManifest)
    expect(result.valid).toBe(false)
  })

  it('returns valid: false when edl is not an object', () => {
    const result = validateEDL('not an object', testManifest)
    expect(result.valid).toBe(false)
  })

  it('returns valid: false when audio is missing', () => {
    const edl = { ...validEDL, audio: undefined }
    const result = validateEDL(edl, testManifest)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.field === 'audio')).toBe(true)
  })

  it('returns valid: false when thumbnail is missing', () => {
    const edl = { ...validEDL, thumbnail: undefined }
    const result = validateEDL(edl, testManifest)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.field === 'thumbnail')).toBe(true)
  })

  it('returns a warning for runway segment missing prompt', () => {
    const edl: EDL = {
      ...validEDL,
      timeline: [
        { id: 'seg1', type: 'generated', processor: 'runway', durationSeconds: 3 },
      ],
    }
    const result = validateEDL(edl, testManifest)
    expect(result.warnings.some(w => w.message.includes('Runway segment missing prompt'))).toBe(true)
  })

  it('returns a warning for elevenlabs segment missing prompt', () => {
    const edl: EDL = {
      ...validEDL,
      timeline: [
        { id: 'seg1', type: 'clip', processor: 'elevenlabs', durationSeconds: 3 },
      ],
    }
    const result = validateEDL(edl, testManifest)
    expect(result.warnings.some(w => w.message.includes('ElevenLabs segment missing prompt'))).toBe(true)
  })

  it('validates sources array asset references', () => {
    const edl: EDL = {
      ...validEDL,
      timeline: [
        {
          id: 'seg1',
          type: 'before_after',
          processor: 'ffmpeg',
          sources: [
            { source: 'clip1.mp4' },
            { source: 'nonexistent.mp4' },
          ],
          durationSeconds: 5,
        },
      ],
    }
    const result = validateEDL(edl, testManifest)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.message.includes('nonexistent.mp4'))).toBe(true)
  })
})
