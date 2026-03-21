# Splicewerk: Implementation Handoff

## Purpose

This document bridges the planning conversation (in Claude App) to execution (in Claude Code). It defines the MVP scope, the agent task breakdown for parallel work, and the multi-format output system.

---

## MVP Goal: YouTube Intro Clip Generator

**What "done" looks like:** Run a CLI command with a prompt + assets, get back a branded intro clip rendered in multiple formats (YouTube, Instagram Reels, TikTok, etc.) ready to upload.

```bash
splicewerk produce \
  --prompt "Create a 15-second intro for our brake upgrade video on the Civic" \
  --assets ./projects/civic-brakes/raw/ \
  --formats youtube,instagram-reels,tiktok
```

**Output:**
```
projects/civic-brakes/output/
├── youtube/
│   └── civic-brakes-intro_1920x1080_30fps.mp4      # 16:9, 1080p
├── instagram-reels/
│   └── civic-brakes-intro_1080x1920_30fps.mp4      # 9:16, 1080p
├── instagram-feed/
│   └── civic-brakes-intro_1080x1080_30fps.mp4      # 1:1, 1080p
├── tiktok/
│   └── civic-brakes-intro_1080x1920_30fps.mp4      # 9:16, 1080p
├── youtube-shorts/
│   └── civic-brakes-intro_1080x1920_30fps.mp4      # 9:16, 1080p
├── facebook/
│   └── civic-brakes-intro_1200x628_30fps.mp4       # ~1.91:1
├── twitter-x/
│   └── civic-brakes-intro_1920x1080_30fps.mp4      # 16:9, 1080p
├── thumbnail/
│   └── civic-brakes-thumb_1280x720.jpg              # YouTube thumbnail
└── edl.json                                          # The generated edit decision list
```

---

## Multi-Format Output System

### Format Presets

These live in `src/config/formats.yaml` and define the rendering specs per platform:

```yaml
formats:
  youtube:
    label: "YouTube (16:9)"
    width: 1920
    height: 1080
    fps: 30
    aspect_ratio: "16:9"
    codec: h264
    crf: 18
    max_bitrate: "20M"
    audio_bitrate: "192k"
    pixel_format: yuv420p
    container: mp4
    max_duration: null  # no limit
    notes: "Primary format — all other formats derive from this"

  youtube-shorts:
    label: "YouTube Shorts (9:16)"
    width: 1080
    height: 1920
    fps: 30
    aspect_ratio: "9:16"
    codec: h264
    crf: 20
    max_bitrate: "10M"
    audio_bitrate: "128k"
    pixel_format: yuv420p
    container: mp4
    max_duration: 60
    crop_strategy: "center"  # how to reframe 16:9 → 9:16
    notes: "Max 60 seconds"

  instagram-reels:
    label: "Instagram Reels (9:16)"
    width: 1080
    height: 1920
    fps: 30
    aspect_ratio: "9:16"
    codec: h264
    crf: 20
    max_bitrate: "10M"
    audio_bitrate: "128k"
    pixel_format: yuv420p
    container: mp4
    max_duration: 90
    crop_strategy: "center"

  instagram-feed:
    label: "Instagram Feed (1:1)"
    width: 1080
    height: 1080
    fps: 30
    aspect_ratio: "1:1"
    codec: h264
    crf: 20
    max_bitrate: "8M"
    audio_bitrate: "128k"
    pixel_format: yuv420p
    container: mp4
    max_duration: 60
    crop_strategy: "center"

  tiktok:
    label: "TikTok (9:16)"
    width: 1080
    height: 1920
    fps: 30
    aspect_ratio: "9:16"
    codec: h264
    crf: 20
    max_bitrate: "10M"
    audio_bitrate: "128k"
    pixel_format: yuv420p
    container: mp4
    max_duration: 180
    crop_strategy: "center"

  facebook:
    label: "Facebook Feed (~1.91:1)"
    width: 1200
    height: 628
    fps: 30
    aspect_ratio: "1.91:1"
    codec: h264
    crf: 20
    max_bitrate: "8M"
    audio_bitrate: "128k"
    pixel_format: yuv420p
    container: mp4
    max_duration: 240
    crop_strategy: "letterbox"  # add bars rather than crop

  twitter-x:
    label: "Twitter/X (16:9)"
    width: 1920
    height: 1080
    fps: 30
    aspect_ratio: "16:9"
    codec: h264
    crf: 20
    max_bitrate: "15M"
    audio_bitrate: "128k"
    pixel_format: yuv420p
    container: mp4
    max_duration: 140

  thumbnail:
    label: "YouTube Thumbnail"
    width: 1280
    height: 720
    format: jpg
    quality: 95
```

### Reframing Strategy

When converting from 16:9 (YouTube master) to other aspect ratios, the system uses one of these strategies per format:

- **`center`** — crop from center (default for most vertical formats). For car content, this usually captures the subject well.
- **`smart`** — (future) use scene detection to find the subject and crop around it.
- **`letterbox`** — add black/branded bars instead of cropping. Preserves full frame.
- **`custom`** — per-segment crop positions defined in the EDL (LLM can specify).

The master render is always 16:9 YouTube format. All other formats are derived from it. This means:
1. Render the full video once at 1920x1080
2. Generate format variants in parallel (just FFmpeg crop/scale + re-encode)
3. If `max_duration` is exceeded, trim to fit or flag for manual review

---

## Claude Code Agent Task Breakdown

### How to Use These Tasks

Each task below is scoped to be executable by a single Claude Code agent session. Tasks within the same phase can run in **parallel** across multiple Claude Code instances/worktrees.

**Naming convention:** `CC-P{phase}-{number}` (Claude Code - Phase - Task)

---

### Phase 0: Project Bootstrap (Sequential — do this first)

#### CC-P0-01: Scaffold the project

**Context files to provide:**
- This document (`splicewerk-implementation-handoff.md`)
- Getting started checklist (`splicewerk-getting-started.md`)

**Instructions:**
> Scaffold the Splicewerk project following the getting-started checklist Part 4 exactly. Use ASDF with Python 3.12+ and Node 24+. Use UV for Python, pnpm for Node, Ruff for Python linting. Create the full directory structure, configs (tsconfig.json, ruff.toml, .tool-versions, .gitignore, .env.example), and install all dependencies. Initialize git with an initial commit.

**Done when:** `pnpm build` succeeds, `ruff check` passes, directory structure matches the plan.

---

### Phase 1: Core Services (Parallel — 4 agents)

These are independent modules with no dependencies on each other. Each produces a service module with types, implementation, and tests.

#### CC-P1-01: Asset Catalog Service

**Instructions:**
> Build `src/services/asset-catalog.ts` — a service that takes a directory path, scans for media files (mp4, mov, jpg, png, mp3, wav), and returns a typed manifest with metadata extracted via ffprobe (duration, resolution, fps, codec, file size, creation date). Include a `catalogAssets(dirPath: string): Promise<AssetManifest>` function. Define all TypeScript types in `src/edl/types.ts`. Write tests using sample fixture data. Use `child_process.execFile` to call ffprobe.

**Output:** `src/services/asset-catalog.ts`, `src/edl/types.ts` (shared types), tests

#### CC-P1-02: FFmpeg Service

**Instructions:**
> Build `src/services/ffmpeg.ts` — a service wrapping FFmpeg operations. Implement these functions: `trimClip(input, start, end, output)`, `concatClips(inputs[], output)`, `splitScreen(left, right, output, options)`, `crossfade(clipA, clipB, duration, output)`, `addTextOverlay(input, text, position, style, output)`, `mixAudio(videoInput, audioInput, volumes, output)`, `reformat(input, formatPreset, output)` for multi-format conversion. Each function should build and execute FFmpeg commands using child_process. Use VideoToolbox hardware acceleration where possible (`-c:v h264_videotoolbox`). Include the format presets YAML from this handoff doc. Write unit tests that validate command construction (mock the actual execution).

**Output:** `src/services/ffmpeg.ts`, `src/config/formats.yaml`, tests

#### CC-P1-03: LLM Service (Nemotron via Ollama)

**Instructions:**
> Build `src/services/llm.ts` — a service that calls Nemotron 3 Super via Ollama's OpenAI-compatible API at `http://localhost:11434/v1`. Implement `generateEDL(prompt, assetManifest, channelConfig): Promise<EDL>` that sends a system prompt instructing the model to output a JSON EDL, the user's prompt, and the asset manifest. Parse and validate the JSON response against the EDL types. Include retry logic (3 attempts) and a fallback to nemotron-3-nano if the cloud model is unavailable. The system prompt should include the EDL schema, available assets, channel branding config, and available music library. Define the full EDL interface in `src/edl/types.ts`.

**Output:** `src/services/llm.ts`, expanded `src/edl/types.ts`, system prompt template, tests

#### CC-P1-04: ElevenLabs Service

**Instructions:**
> Build `src/services/elevenlabs.ts` — a service for generating sound effects and music via ElevenLabs API. Implement `generateSFX(prompt, durationSeconds): Promise<string>` (returns local file path after downloading), `generateMusic(prompt, durationSeconds): Promise<string>`, and `generateTTS(text, voiceId?): Promise<string>`. Use the official ElevenLabs API endpoints. Handle async polling for completed generations. Store outputs in the project's `rendered/` directory. Include rate limiting awareness (respect plan credit limits). Write tests with mocked API responses.

**Output:** `src/services/elevenlabs.ts`, tests

---

### Phase 2: Pipeline Assembly (Parallel — 3 agents)

These depend on Phase 1 services being complete.

#### CC-P2-01: EDL Validator & Translator

**Instructions:**
> Build `src/edl/validator.ts` and `src/edl/translator.ts`. The validator takes a raw EDL JSON object and validates it against the EDL TypeScript types — checking that referenced assets exist in the manifest, durations are positive, processor values are valid ("ffmpeg" | "runway" | "elevenlabs"), and required fields are present. Return a typed result with errors/warnings. The translator takes a validated EDL and produces an ordered list of processing steps — each step is a concrete command (FFmpeg args, API call params, etc.) that the orchestrator will execute. Include the multi-format output step generation (one reformat step per requested format).

**Output:** `src/edl/validator.ts`, `src/edl/translator.ts`, tests

#### CC-P2-02: Inngest Pipeline

**Instructions:**
> Build `src/inngest/client.ts` and `src/inngest/functions/produce-video.ts`. Wire up the full pipeline as an Inngest function triggered by the `video/production-requested` event. Steps: catalog-assets → generate-edl → validate-edl → prepare-assets → [render each segment] → composite → audio-mix → add-text → finalize (master render) → [parallel: reformat for each requested output format] → generate-thumbnail. Use `step.waitForEvent` for missing asset requests. Each step should call the appropriate service. Import types from `src/edl/types.ts`. Include the Inngest serve configuration in `inngest.config.ts`.

**Output:** `src/inngest/client.ts`, `src/inngest/functions/produce-video.ts`, `inngest.config.ts`

#### CC-P2-03: CLI Interface

**Instructions:**
> Build `src/cli/index.ts` — the command-line interface. Use a lightweight arg parser (yargs or commander). Support these commands: `splicewerk produce --prompt "..." --assets ./path/ --formats youtube,instagram-reels,tiktok` (triggers the pipeline), `splicewerk catalog --assets ./path/` (just catalogs assets and prints manifest), `splicewerk formats` (lists available output formats), `splicewerk status --project <name>` (checks pipeline status). The produce command should emit an Inngest event to trigger the pipeline. Include a `--dry-run` flag that generates the EDL without rendering. Load `.env` via dotenv.

**Output:** `src/cli/index.ts`, updated `package.json` scripts

---

### Phase 3: Runway Integration (Single agent, after Phase 2)

#### CC-P3-01: Runway Service

**Instructions:**
> Build `src/services/runway.ts` — integration with Runway's API for generative video. Implement `imageToVideo(imagePath, prompt, duration): Promise<string>`, `textToVideo(prompt, duration): Promise<string>`, and `editVideo(videoPath, editPrompt): Promise<string>` using the @runwayml/sdk. Handle async task polling (Runway generations take 30-120 seconds). Download completed videos to local project directory. Include cost tracking (estimate credits consumed per call). Write tests with mocked SDK responses.

**Output:** `src/services/runway.ts`, tests

---

### Phase 4: Polish & Multi-format (Parallel — 2 agents)

#### CC-P4-01: Thumbnail Generator

**Instructions:**
> Build `src/services/thumbnail.ts` using Sharp. Implement styles from channel.yaml: `beforeAfterSplit(leftFrame, rightFrame, text, style)`, `singleFrame(frame, text, style)`, `collage(frames[], text, style)`. Extract frames from video at specified timestamps via FFmpeg, then compose thumbnails with text overlays, dividers, and channel branding. Output at 1280x720 JPG.

**Output:** `src/services/thumbnail.ts`, tests

#### CC-P4-02: Channel Config & Music Library

**Instructions:**
> Build `src/config/channel.ts` — loader and types for `channel.yaml` and `music-library.yaml`. The channel config includes branding (colors, fonts, logo, watermark), intro/outro templates, default settings, text styles, and thumbnail styles. The music library config maps tags (mood, energy, genre) to local file paths. Include a `selectMusic(mood, energy, minDuration): MusicTrack` function the LLM can use. Validate configs on load and provide clear error messages for missing fonts/assets.

**Output:** `src/config/channel.ts`, `src/config/channel.yaml` (template), `src/config/music-library.yaml` (template), tests

---

## Dependency Graph

```
Phase 0: CC-P0-01 (scaffold)
    │
    ├── Phase 1 (parallel):
    │   ├── CC-P1-01 (asset catalog)
    │   ├── CC-P1-02 (ffmpeg service)
    │   ├── CC-P1-03 (llm service)
    │   └── CC-P1-04 (elevenlabs service)
    │
    ├── Phase 2 (parallel, after Phase 1):
    │   ├── CC-P2-01 (edl validator + translator)
    │   ├── CC-P2-02 (inngest pipeline)
    │   └── CC-P2-03 (cli interface)
    │
    ├── Phase 3 (after Phase 2):
    │   └── CC-P3-01 (runway service)
    │
    └── Phase 4 (parallel, after Phase 2):
        ├── CC-P4-01 (thumbnail generator)
        └── CC-P4-02 (channel config + music library)
```

### Maximum Parallelism

- **Phase 0:** 1 agent (must complete first)
- **Phase 1:** 4 agents simultaneously
- **Phase 2:** 3 agents simultaneously
- **Phase 3:** 1 agent
- **Phase 4:** 2 agents simultaneously

Total unique agents needed if fully parallelized: **4 concurrent** (Phase 1 is the widest).

---

## Shared Types Contract (src/edl/types.ts)

All agents in Phase 1 contribute to this file. To avoid merge conflicts, define the skeleton first in CC-P0-01 (scaffold), then each agent extends it. The core types:

```typescript
// ─── Asset Manifest ───
export interface AssetFile {
  path: string;
  filename: string;
  type: 'video' | 'image' | 'audio';
  duration?: number;       // seconds (video/audio only)
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  fileSize: number;        // bytes
  createdAt?: string;      // ISO date
}

export interface AssetManifest {
  rootDir: string;
  files: AssetFile[];
  catalogedAt: string;
}

// ─── Edit Decision List ───
export interface EDLProject {
  title: string;
  targetDurationSeconds: number;
  aspectRatio: string;
  resolution: string;
  outputFormats: string[];  // ['youtube', 'instagram-reels', 'tiktok']
}

export interface MissingAsset {
  description: string;
  purpose: string;
  priority: 'required' | 'nice-to-have';
}

export interface TimelineSegment {
  id: string;
  type: 'intro' | 'outro' | 'title_card' | 'before_after' | 'montage' | 'clip' | 'transition' | 'generated';
  processor: 'ffmpeg' | 'runway' | 'elevenlabs';
  source?: string;
  sources?: { source: string; trim?: string }[];
  operation?: string;
  prompt?: string;
  durationSeconds?: number;
  trim?: string;
  transition?: string;
  textOverlay?: TextOverlay;
  cropHints?: CropHint[];  // per-format reframing hints
}

export interface TextOverlay {
  text: string;
  position: string;
  style: string;
  leftLabel?: string;
  rightLabel?: string;
}

export interface CropHint {
  format: string;          // 'instagram-reels', 'tiktok', etc.
  focusPoint: 'center' | 'left' | 'right' | 'subject';
  offsetX?: number;
  offsetY?: number;
}

export interface AudioConfig {
  backgroundMusic?: {
    source: string;
    volume: number;
    fadeIn: number;
    fadeOut: number;
  };
  sfx?: {
    source: string;
    prompt?: string;       // for AI-generated SFX
    timestamp: number;
    volume: number;
  }[];
  originalAudio?: {
    segments: string[];
    volume: number;
  };
}

export interface ThumbnailConfig {
  type: string;
  style: string;
  text?: string;
  leftFrame?: { source: string; timestamp: string };
  rightFrame?: { source: string; timestamp: string };
  frame?: { source: string; timestamp: string };
}

export interface EDL {
  project: EDLProject;
  missingAssets: MissingAsset[];
  timeline: TimelineSegment[];
  audio: AudioConfig;
  thumbnail: ThumbnailConfig;
}

// ─── Output Formats ───
export interface FormatPreset {
  label: string;
  width: number;
  height: number;
  fps: number;
  aspectRatio: string;
  codec: string;
  crf: number;
  maxBitrate: string;
  audioBitrate: string;
  pixelFormat: string;
  container: string;
  maxDuration: number | null;
  cropStrategy: 'center' | 'smart' | 'letterbox' | 'custom';
  notes?: string;
}

// ─── Processing Steps ───
export interface ProcessingStep {
  id: string;
  type: 'ffmpeg' | 'runway' | 'elevenlabs' | 'sharp' | 'reformat';
  segmentId?: string;
  input: string | string[];
  output: string;
  params: Record<string, unknown>;
  estimatedDuration?: number;
  estimatedCost?: number;   // USD, for cloud API calls
}
```

---

## Context Files for Claude Code Sessions

When starting a Claude Code agent, provide these files as context:

### For ALL agents:
- `splicewerk-implementation-handoff.md` (this file)
- `src/edl/types.ts` (shared types — after Phase 0 creates it)

### Additional context per task:
- **CC-P1-02 (FFmpeg):** `src/config/formats.yaml`
- **CC-P1-03 (LLM):** `splicewerk-framework-plan.md` (for EDL examples and system prompt design)
- **CC-P2-02 (Inngest):** All Phase 1 service files
- **CC-P2-03 (CLI):** `splicewerk-getting-started.md` (for package.json scripts reference)
- **CC-P4-02 (Channel config):** `splicewerk-framework-plan.md` (for channel.yaml template)

---

## Notes for Claude Code Execution

1. **Git workflow:** Create a feature branch per task (`feat/CC-P1-01-asset-catalog`). Merge to `main` after each phase completes.

2. **Testing:** Each service should have co-located test files (`*.test.ts`). Use Node's built-in test runner (`node:test`) or vitest. Mock external calls (FFmpeg, APIs, Ollama).

3. **Error handling:** Every service function should return typed results, not throw. Use a `Result<T, E>` pattern or similar.

4. **Logging:** Use a simple structured logger. Each service should log at `info` level for operations and `debug` for details.

5. **The shared types file (`src/edl/types.ts`)** is the integration contract. If you change the types, all downstream consumers need to be updated. Phase 0 creates the skeleton; Phase 1 agents extend it; Phase 2 agents consume it.
