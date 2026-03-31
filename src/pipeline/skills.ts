import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

// ─── Capability Index ─────────────────────────────────────────────────────────
// Shown in every orchestration round. One line per service, kept tight.
// Maverick reads this to decide which services it needs full docs on.

export const CAPABILITY_INDEX = `
fal-ai         | 1000+ models — video I2V/T2V (Kling v3 ~$0.03/s, Veo 3.1, Sora 2, Wan), image gen (Flux 2, Ideogram for text-in-image), upscaling (Topaz pro-grade), bg removal (Bria image+video), avatar/lipsync (Aurora, Omnihuman, Sync), TTS, music (Beatoven), SFX (Mirelo video→audio)
runway         | Video I2V/T2V + Aleph V2V editing (add rain/effects to existing video, only service that does this) + image gen with @reference tagging for style consistency — credit-based
elevenlabs     | TTS (streaming, word timestamps), SFX from description, music gen, Scribe transcription (word-level), voice cloning, voice isolation, voice changer, dubbing/localization, forced alignment
epidemic-sound | 55K+ licensed music tracks + 200K SFX — MCP-based discovery, manual download, no YouTube Content ID issues
motion-graphics| Remotion (React-based, free, local render, composites over video), Hera (AI text animations, $16-49/mo), Shotstack/Creatomate (template JSON→video API)
ffmpeg         | Local processing — trim, stabilize, fade, concat, crossfade, slow-mo, overlay text, subtitles, normalize audio, split on scenes, PiP, watermark (free, no API cost)
`.trim()

// ─── Skill Doc Paths ──────────────────────────────────────────────────────────
// Full capability markdown — only loaded when Maverick requests a specific service

const SKILL_PATHS: Record<string, string> = {
  'fal-ai': join(homedir(), '.claude/skills/gen-media-api/references/falai.md'),
  'runway': join(homedir(), '.claude/skills/gen-media-api/references/runway.md'),
  'elevenlabs': join(homedir(), '.claude/skills/gen-media-api/references/elevenlabs.md'),
  'epidemic-sound': join(homedir(), '.claude/skills/gen-media-api/references/epidemic-sound.md'),
  'motion-graphics': join(homedir(), '.claude/skills/gen-media-api/references/motion-graphics.md'),
}

export const ALL_SKILL_NAMES = Object.keys(SKILL_PATHS)

// ─── Loader ───────────────────────────────────────────────────────────────────

/**
 * Loads full capability docs for the requested skills.
 * Unknown skill names are silently skipped.
 * Returns a map of skill name → markdown content.
 */
export async function loadSkillDocs(skills: string[]): Promise<Record<string, string>> {
  const docs: Record<string, string> = {}
  const valid = skills.filter(s => s in SKILL_PATHS)

  await Promise.all(
    valid.map(async (skill) => {
      try {
        docs[skill] = await readFile(SKILL_PATHS[skill], 'utf-8')
      } catch {
        docs[skill] = `[Skill docs for "${skill}" could not be loaded]`
      }
    })
  )

  return docs
}

/**
 * Formats loaded skill docs as a prompt section.
 * Each doc is wrapped with a header so Maverick knows which service it belongs to.
 */
export function formatSkillDocs(docs: Record<string, string>): string {
  if (Object.keys(docs).length === 0) return ''
  return Object.entries(docs)
    .map(([name, content]) => `### Service Details: ${name}\n\n${content}`)
    .join('\n\n---\n\n')
}
