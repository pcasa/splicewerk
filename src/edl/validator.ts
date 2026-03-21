import type { EDL, AssetManifest } from './types.js'

// ─── Validation Result ───

export interface ValidationError {
  field: string
  message: string
  severity: 'error' | 'warning'
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationError[]
}

const KNOWN_FORMATS = new Set([
  'youtube',
  'youtube-shorts',
  'instagram-reels',
  'instagram-feed',
  'tiktok',
  'facebook',
  'twitter-x',
  'thumbnail',
])

const VALID_PROCESSORS = new Set(['ffmpeg', 'runway', 'elevenlabs'])

const VALID_SEGMENT_TYPES = new Set([
  'intro',
  'outro',
  'title_card',
  'before_after',
  'montage',
  'clip',
  'transition',
  'generated',
])

export function validateEDL(edl: unknown, manifest: AssetManifest): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationError[] = []

  function addError(field: string, message: string) {
    errors.push({ field, message, severity: 'error' })
  }

  function addWarning(field: string, message: string) {
    warnings.push({ field, message, severity: 'warning' })
  }

  // Structure check: edl must be a non-null object
  if (edl === null || typeof edl !== 'object') {
    addError('edl', 'EDL must be a non-null object')
    return { valid: false, errors, warnings }
  }

  const edlObj = edl as Record<string, unknown>

  // Check project
  if (!edlObj['project'] || typeof edlObj['project'] !== 'object' || edlObj['project'] === null) {
    addError('project', 'EDL must have a project object')
  } else {
    const project = edlObj['project'] as Record<string, unknown>

    if (typeof project['title'] !== 'string' || project['title'] === '') {
      addError('project.title', 'Project must have a non-empty title string')
    }

    if (typeof project['targetDurationSeconds'] !== 'number' || project['targetDurationSeconds'] <= 0) {
      addError('project.targetDurationSeconds', 'Project targetDurationSeconds must be a number > 0')
    } else if (project['targetDurationSeconds'] > 120) {
      addWarning('project.targetDurationSeconds', 'unusually long video')
    }

    if (typeof project['aspectRatio'] !== 'string' || project['aspectRatio'] === '') {
      addError('project.aspectRatio', 'Project must have a non-empty aspectRatio string')
    }

    if (typeof project['resolution'] !== 'string' || project['resolution'] === '') {
      addError('project.resolution', 'Project must have a non-empty resolution string')
    }

    if (!Array.isArray(project['outputFormats']) || (project['outputFormats'] as unknown[]).length === 0) {
      addError('project.outputFormats', 'Project outputFormats must be a non-empty array')
    } else {
      const formats = project['outputFormats'] as unknown[]
      for (const fmt of formats) {
        if (typeof fmt === 'string' && !KNOWN_FORMATS.has(fmt)) {
          addWarning('project.outputFormats', `Unrecognized output format: ${fmt}`)
        }
      }
    }
  }

  // Check timeline
  if (!Array.isArray(edlObj['timeline'])) {
    addError('timeline', 'EDL timeline must be an array')
  } else if ((edlObj['timeline'] as unknown[]).length === 0) {
    addError('timeline', 'EDL timeline must not be empty')
  } else {
    const timeline = edlObj['timeline'] as unknown[]
    const manifestFilenames = new Set(manifest.files.map(f => f.filename))

    timeline.forEach((seg, idx) => {
      if (seg === null || typeof seg !== 'object') {
        addError(`timeline[${idx}]`, 'Timeline segment must be an object')
        return
      }

      const segment = seg as Record<string, unknown>

      if (typeof segment['id'] !== 'string' || segment['id'] === '') {
        addError(`timeline[${idx}].id`, 'Segment must have a non-empty id string')
      }

      if (typeof segment['type'] !== 'string' || !VALID_SEGMENT_TYPES.has(segment['type'] as string)) {
        addError(`timeline[${idx}].type`, `Segment type must be a valid union value, got: ${String(segment['type'])}`)
      }

      if (typeof segment['processor'] !== 'string' || !VALID_PROCESSORS.has(segment['processor'] as string)) {
        addError(`timeline[${idx}].processor`, `Segment processor must be 'ffmpeg', 'runway', or 'elevenlabs', got: ${String(segment['processor'])}`)
      } else {
        const processor = segment['processor'] as string
        if (processor === 'runway' && !segment['prompt']) {
          addWarning(`timeline[${idx}].prompt`, 'Runway segment missing prompt')
        }
        if (processor === 'elevenlabs' && !segment['prompt']) {
          addWarning(`timeline[${idx}].prompt`, 'ElevenLabs segment missing prompt')
        }
      }

      if (segment['durationSeconds'] !== undefined) {
        if (typeof segment['durationSeconds'] !== 'number' || segment['durationSeconds'] <= 0) {
          addError(`timeline[${idx}].durationSeconds`, 'Segment durationSeconds must be a number > 0')
        }
      }

      // Asset reference checks
      if (typeof segment['source'] === 'string') {
        if (!manifestFilenames.has(segment['source'])) {
          addError(`timeline[${idx}].source`, `Asset '${segment['source']}' not found in manifest`)
        }
      }

      if (Array.isArray(segment['sources'])) {
        const sources = segment['sources'] as unknown[]
        sources.forEach((src, srcIdx) => {
          if (src !== null && typeof src === 'object') {
            const srcObj = src as Record<string, unknown>
            if (typeof srcObj['source'] === 'string' && !manifestFilenames.has(srcObj['source'])) {
              addError(`timeline[${idx}].sources[${srcIdx}].source`, `Asset '${String(srcObj['source'])}' not found in manifest`)
            }
          }
        })
      }
    })
  }

  // Check audio
  if (!edlObj['audio'] || typeof edlObj['audio'] !== 'object' || edlObj['audio'] === null) {
    addError('audio', 'EDL must have an audio object')
  }

  // Check thumbnail
  if (!edlObj['thumbnail'] || typeof edlObj['thumbnail'] !== 'object' || edlObj['thumbnail'] === null) {
    addError('thumbnail', 'EDL must have a thumbnail object')
  } else {
    const thumbnail = edlObj['thumbnail'] as Record<string, unknown>
    if (typeof thumbnail['type'] !== 'string' || thumbnail['type'] === '') {
      addError('thumbnail.type', 'Thumbnail must have a non-empty type string')
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}
