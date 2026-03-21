import { describe, it, expect } from 'vitest'
import { translateEDL } from './translator.js'
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

const testEDL: EDL = {
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

describe('translateEDL', () => {
  it('returns steps array with correct length (segments + composite + audio-mix + reformats + thumbnail)', () => {
    // 2 segments + 1 composite + 1 audio-mix + 1 reformat (youtube) + 1 thumbnail = 6
    const result = translateEDL(testEDL, testManifest)
    expect(result.steps).toHaveLength(6)
  })

  it('segment steps have correct type based on processor', () => {
    const result = translateEDL(testEDL, testManifest)
    const seg1Step = result.steps.find(s => s.id === 'step_seg1')
    const seg2Step = result.steps.find(s => s.id === 'step_seg2')
    expect(seg1Step?.type).toBe('ffmpeg')
    expect(seg2Step?.type).toBe('runway')
  })

  it('elevenlabs segments produce .mp3 output', () => {
    const edl: EDL = {
      ...testEDL,
      timeline: [
        { id: 'voice1', type: 'clip', processor: 'elevenlabs', prompt: 'hello world', durationSeconds: 2 },
      ],
      audio: {},
    }
    const result = translateEDL(edl, testManifest)
    const voiceStep = result.steps.find(s => s.id === 'step_voice1')
    expect(voiceStep?.output).toBe('rendered/voice1.mp3')
    expect(voiceStep?.type).toBe('elevenlabs')
  })

  it('composite step is always present and comes after segment steps', () => {
    const result = translateEDL(testEDL, testManifest)
    const compositeStep = result.steps.find(s => s.id === 'step_composite')
    expect(compositeStep).toBeDefined()
    expect(compositeStep?.type).toBe('ffmpeg')
    expect(compositeStep?.params['operation']).toBe('concat')

    // Composite step should come after all segment steps
    const compositeIdx = result.steps.findIndex(s => s.id === 'step_composite')
    const seg1Idx = result.steps.findIndex(s => s.id === 'step_seg1')
    const seg2Idx = result.steps.findIndex(s => s.id === 'step_seg2')
    expect(compositeIdx).toBeGreaterThan(seg1Idx)
    expect(compositeIdx).toBeGreaterThan(seg2Idx)
  })

  it('composite step input includes all segment output paths', () => {
    const result = translateEDL(testEDL, testManifest)
    const compositeStep = result.steps.find(s => s.id === 'step_composite')
    expect(Array.isArray(compositeStep?.input)).toBe(true)
    const inputs = compositeStep?.input as string[]
    expect(inputs).toContain('rendered/seg1.mp4')
    expect(inputs).toContain('rendered/seg2.mp4')
  })

  it('reformat steps created for each requested format', () => {
    const result = translateEDL(testEDL, testManifest, ['youtube', 'tiktok'])
    const reformatSteps = result.steps.filter(s => s.type === 'reformat')
    expect(reformatSteps).toHaveLength(2)
    expect(reformatSteps.some(s => s.id === 'step_reformat_youtube')).toBe(true)
    expect(reformatSteps.some(s => s.id === 'step_reformat_tiktok')).toBe(true)
  })

  it('reformat steps created from edl.project.outputFormats when no requestedFormats given', () => {
    const result = translateEDL(testEDL, testManifest)
    const reformatSteps = result.steps.filter(s => s.type === 'reformat')
    expect(reformatSteps).toHaveLength(1)
    expect(reformatSteps[0].id).toBe('step_reformat_youtube')
  })

  it('reformat step params includes format preset data for known formats', () => {
    const result = translateEDL(testEDL, testManifest, ['youtube'])
    const reformatStep = result.steps.find(s => s.id === 'step_reformat_youtube')
    expect(reformatStep).toBeDefined()
    // Known format should have preset fields, not just { formatName }
    expect(reformatStep?.params).not.toHaveProperty('formatName')
    expect(reformatStep?.params).toHaveProperty('width')
    expect(reformatStep?.params).toHaveProperty('height')
  })

  it('reformat step params uses { formatName } for unknown formats', () => {
    const result = translateEDL(testEDL, testManifest, ['unknown-format-xyz'])
    const reformatStep = result.steps.find(s => s.id === 'step_reformat_unknown-format-xyz')
    expect(reformatStep?.params).toEqual({ formatName: 'unknown-format-xyz' })
  })

  it('thumbnail step always present', () => {
    const result = translateEDL(testEDL, testManifest)
    const thumbnailStep = result.steps.find(s => s.id === 'step_thumbnail')
    expect(thumbnailStep).toBeDefined()
    expect(thumbnailStep?.type).toBe('sharp')
    expect(thumbnailStep?.output).toBe('rendered/thumbnail/thumb.jpg')
    expect(thumbnailStep?.input).toBe('rendered/master.mp4')
  })

  it('thumbnail step params includes thumbnail config fields', () => {
    const result = translateEDL(testEDL, testManifest)
    const thumbnailStep = result.steps.find(s => s.id === 'step_thumbnail')
    expect(thumbnailStep?.params['type']).toBe('single')
    expect(thumbnailStep?.params['style']).toBe('default')
  })

  it('estimatedCostUSD > 0 when timeline has runway segments', () => {
    const result = translateEDL(testEDL, testManifest)
    expect(result.estimatedCostUSD).toBeGreaterThan(0)
  })

  it('estimatedCostUSD is 0 when all segments are ffmpeg', () => {
    const edl: EDL = {
      ...testEDL,
      timeline: [
        { id: 'seg1', type: 'clip', processor: 'ffmpeg', source: 'clip1.mp4', durationSeconds: 5 },
      ],
      audio: {},
    }
    const result = translateEDL(edl, testManifest)
    expect(result.estimatedCostUSD).toBe(0)
  })

  it('estimatedDurationMs is a positive number', () => {
    const result = translateEDL(testEDL, testManifest)
    expect(result.estimatedDurationMs).toBeGreaterThan(0)
  })

  it('audio-mix step uses rendered/master_mixed.mp4 as final master when backgroundMusic exists', () => {
    const result = translateEDL(testEDL, testManifest)
    const audioMixStep = result.steps.find(s => s.id === 'step_audio_mix')
    expect(audioMixStep).toBeDefined()

    // Reformat should use master_mixed
    const reformatStep = result.steps.find(s => s.id === 'step_reformat_youtube')
    expect(reformatStep?.input).toBe('rendered/master_mixed.mp4')
  })

  it('no audio-mix step when backgroundMusic is absent', () => {
    const edl: EDL = { ...testEDL, audio: {} }
    const result = translateEDL(edl, testManifest)
    const audioMixStep = result.steps.find(s => s.id === 'step_audio_mix')
    expect(audioMixStep).toBeUndefined()

    // Reformat should use master.mp4
    const reformatStep = result.steps.find(s => s.id === 'step_reformat_youtube')
    expect(reformatStep?.input).toBe('rendered/master.mp4')
  })

  it('audio-mix step volumes reflect originalAudio.volume and backgroundMusic.volume', () => {
    const edl: EDL = {
      ...testEDL,
      audio: {
        backgroundMusic: { source: 'music.mp3', volume: 0.3, fadeIn: 1, fadeOut: 2 },
        originalAudio: { segments: [], volume: 0.8 },
      },
    }
    const result = translateEDL(edl, testManifest)
    const audioMixStep = result.steps.find(s => s.id === 'step_audio_mix')
    const volumes = audioMixStep?.params['volumes'] as { video: number; audio: number }
    expect(volumes?.video).toBe(0.8)
    expect(volumes?.audio).toBe(0.3)
  })

  it('audio-mix step defaults video volume to 1.0 when originalAudio is absent', () => {
    const result = translateEDL(testEDL, testManifest)
    const audioMixStep = result.steps.find(s => s.id === 'step_audio_mix')
    const volumes = audioMixStep?.params['volumes'] as { video: number; audio: number }
    expect(volumes?.video).toBe(1.0)
  })
})
