# Splicewerk: Claude Code Agent Prompts

Copy-paste these into Claude Code sessions. Each prompt is self-contained.

---

## Phase 0: Scaffold (1 agent, do this first)

### CC-P0-01: Scaffold the Project

```
Read docs/splicewerk-getting-started.md (Part 4: Project Scaffolding) and docs/splicewerk-implementation-handoff.md.

Execute task CC-P0-01 — scaffold the Splicewerk project.

Requirements:
- ASDF with Python 3.12+ and Node 24+ (create .tool-versions)
- UV for Python package management
- pnpm for Node package management  
- Ruff for Python linting (ruff.toml with target-version py312, line-length 100)
- TypeScript strict mode
- Create the full directory structure from the handoff doc
- Install all Node dependencies: typescript, inngest, @runwayml/sdk, sharp, fluent-ffmpeg, yaml, dotenv
- Install Node dev dependencies: @types/node, @types/fluent-ffmpeg, tsx, vitest
- Install Python dependencies via UV: httpx, pyyaml, python-dotenv
- Install Python dev dependencies: ruff, pytest
- Create tsconfig.json, ruff.toml, .tool-versions, .gitignore, .env.example
- Create the shared types skeleton at src/edl/types.ts using the full type definitions from the "Shared Types Contract" section of the handoff doc
- Create package.json with scripts: dev, build, inngest:dev, produce, lint, format, test
- Create the assets/ subdirectories: intros, outros, music, fonts, logos
- Create an empty projects/ directory with a .gitkeep
- Create src/config/formats.yaml with all format presets from the handoff doc (youtube, youtube-shorts, instagram-reels, instagram-feed, tiktok, facebook, twitter-x, thumbnail)
- Initialize git and make an initial commit

Done when: pnpm build succeeds, ruff check passes, vitest runs (even with 0 tests), and the directory structure matches the handoff doc.
```

**After this completes:** Commit, push to GitHub, then start Phase 1 agents.

---

## Phase 1: Core Services (4 agents in parallel)

Each of these runs on its own feature branch:

### CC-P1-01: Asset Catalog Service

```
You are working on the Splicewerk project — an AI-driven video production framework.

Read docs/splicewerk-implementation-handoff.md for full context. You are executing task CC-P1-01.

Create a new branch: git checkout -b feat/CC-P1-01-asset-catalog

Build src/services/asset-catalog.ts — a service that:
1. Takes a directory path as input
2. Scans recursively for media files: mp4, mov, avi, mkv, jpg, jpeg, png, mp3, wav, aac
3. Runs ffprobe on each file to extract metadata
4. Returns a typed AssetManifest (use types from src/edl/types.ts)

Implementation details:
- Export async function catalogAssets(dirPath: string): Promise<AssetManifest>
- Use child_process.execFile to call ffprobe with JSON output (-print_format json -show_format -show_streams)
- Extract: duration, width, height, fps (r_frame_rate), codec_name, file size, creation_time
- Classify files by extension into type: 'video' | 'image' | 'audio'
- Handle errors gracefully — if ffprobe fails on a file, log a warning and skip it
- Sort files by type, then by filename

Write tests in src/services/__tests__/asset-catalog.test.ts using vitest:
- Test with a mocked directory containing sample file metadata
- Test handling of unsupported file types (should be skipped)
- Test handling of ffprobe failures (should warn, not crash)
- Test that the manifest structure matches the types

Commit to the feature branch when done.
```

### CC-P1-02: FFmpeg Service

```
You are working on the Splicewerk project — an AI-driven video production framework.

Read docs/splicewerk-implementation-handoff.md for full context. You are executing task CC-P1-02.

Create a new branch: git checkout -b feat/CC-P1-02-ffmpeg-service

Build src/services/ffmpeg.ts — a service wrapping FFmpeg operations.

Implement these functions (all async, all return the output file path):

1. trimClip(input: string, startSeconds: number, endSeconds: number, output: string): Promise<string>
2. concatClips(inputs: string[], output: string): Promise<string> — use the concat demuxer approach (file list)
3. splitScreen(left: string, right: string, output: string, options?: { leftLabel?: string, rightLabel?: string, dividerColor?: string, dividerWidth?: number }): Promise<string>
4. crossfade(clipA: string, clipB: string, durationSeconds: number, output: string): Promise<string> — use xfade filter
5. addTextOverlay(input: string, text: string, position: string, style: TextStyle, output: string): Promise<string> — use drawtext filter
6. mixAudio(videoInput: string, audioInput: string, videoVolume: number, audioVolume: number, output: string, options?: { fadeIn?: number, fadeOut?: number }): Promise<string>
7. reformat(input: string, formatPreset: FormatPreset, output: string): Promise<string> — crop/scale/re-encode to match a format preset. Implement the crop strategies: center (calculate crop from center), letterbox (add black bars via pad filter). Use VideoToolbox hardware acceleration where possible (-c:v h264_videotoolbox).
8. extractFrame(input: string, timestampSeconds: number, output: string): Promise<string> — extract a single frame as image

Internal helpers:
- buildCommand(args: string[]): string[] — constructs the ffmpeg argument array
- executeFFmpeg(args: string[]): Promise<void> — runs ffmpeg via child_process.execFile with error handling and logging
- Load format presets from src/config/formats.yaml (the file should already exist from scaffolding)

Create a FormatPreset type if not already in src/edl/types.ts, or import it.

Write tests in src/services/__tests__/ffmpeg.test.ts using vitest:
- Test command construction for each function (mock execFile, validate the args array)
- Test reformat crop calculations for center and letterbox strategies
- Test error handling when ffmpeg returns non-zero exit code

Do NOT run actual ffmpeg in tests — mock the execution layer and verify command construction.

Commit to the feature branch when done.
```

### CC-P1-03: LLM Service (Nemotron via Ollama)

```
You are working on the Splicewerk project — an AI-driven video production framework.

Read docs/splicewerk-implementation-handoff.md and docs/splicewerk-framework-plan.md for full context — especially the EDL JSON example in the framework plan. You are executing task CC-P1-03.

Create a new branch: git checkout -b feat/CC-P1-03-llm-service

Build src/services/llm.ts — a service that calls Nemotron 3 Super via Ollama's OpenAI-compatible API.

Implement:
1. async function generateEDL(prompt: string, assetManifest: AssetManifest, channelConfig: ChannelConfig, outputFormats: string[]): Promise<EDL>
   - Calls POST http://localhost:11434/v1/chat/completions (or OLLAMA_HOST from env)
   - Uses model "nemotron-3-super:cloud"
   - Sends a system prompt + user message
   - Parses JSON response into EDL type
   - Validates the parsed EDL has required fields
   - Retries up to 3 times on failure (malformed JSON, network error)
   - Falls back to "nemotron-3-nano" if cloud model is unavailable

2. Build the system prompt template (src/services/llm-system-prompt.ts or inline):
   The system prompt should instruct the model to:
   - Act as a professional video editor
   - Output ONLY valid JSON matching the EDL schema (provide the schema)
   - Use the provided asset manifest to reference real files
   - Use the channel branding config for styling decisions
   - Choose "ffmpeg" as processor for deterministic operations (trim, concat, split-screen, crossfade, audio mix, text overlay)
   - Choose "runway" as processor for generative operations (image-to-video, stylized transitions)
   - Choose "elevenlabs" as processor for sound effects and AI music
   - Identify any missing assets and list them in missingAssets[]
   - Respect the requested output formats and include cropHints for segments where center-crop would miss the subject
   - Include the full EDL schema as a JSON example in the prompt

3. Helper: async function testConnection(): Promise<boolean> — ping Ollama to verify it's running

Write tests in src/services/__tests__/llm.test.ts using vitest:
- Mock the HTTP call to Ollama
- Test successful EDL generation with a sample response
- Test retry logic on malformed JSON
- Test fallback to nano model
- Test system prompt includes asset filenames and channel config

Commit to the feature branch when done.
```

### CC-P1-04: ElevenLabs Service

```
You are working on the Splicewerk project — an AI-driven video production framework.

Read docs/splicewerk-implementation-handoff.md for full context. You are executing task CC-P1-04.

Create a new branch: git checkout -b feat/CC-P1-04-elevenlabs-service

Build src/services/elevenlabs.ts — a service for generating sound effects and music via the ElevenLabs API.

Implement:
1. async function generateSFX(prompt: string, durationSeconds: number, outputDir: string): Promise<string>
   - POST to https://api.elevenlabs.io/v1/sound-generation
   - Set duration_seconds and text prompt
   - Download the returned audio to outputDir
   - Return the local file path
   - Cost: 20 credits/second via API

2. async function generateMusic(prompt: string, durationSeconds: number, outputDir: string): Promise<string>
   - Use the ElevenLabs music generation endpoint
   - Download result to outputDir
   - Return local file path

3. async function generateTTS(text: string, outputDir: string, voiceId?: string): Promise<string>
   - POST to https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
   - Use a default voice ID if none provided
   - Download audio to outputDir
   - Return local file path

4. Helper: async function getUsage(): Promise<{ creditsUsed: number, creditsRemaining: number }>
   - GET https://api.elevenlabs.io/v1/user/subscription
   - Parse and return credit usage

Internal details:
- Use ELEVENLABS_API_KEY from env
- Set header: xi-api-key
- All functions should include cost tracking (log estimated credits consumed)
- Handle rate limiting (429 responses) with exponential backoff
- Download audio as mp3 files

Write tests in src/services/__tests__/elevenlabs.test.ts using vitest:
- Mock all API calls
- Test successful SFX generation and file download
- Test rate limit handling (retry on 429)
- Test credit usage tracking
- Test error handling for failed generations

Commit to the feature branch when done.
```

---

## Phase 2: Pipeline Assembly (3 agents in parallel, after Phase 1 merges)

### CC-P2-01: EDL Validator & Translator

```
You are working on the Splicewerk project — an AI-driven video production framework.

Read docs/splicewerk-implementation-handoff.md for full context. You are executing task CC-P2-01.

Create a new branch: git checkout -b feat/CC-P2-01-edl-validator-translator

Build two modules:

1. src/edl/validator.ts
   - Export: async function validateEDL(edl: EDL, manifest: AssetManifest): Promise<ValidationResult>
   - ValidationResult has: valid: boolean, errors: string[], warnings: string[]
   - Checks:
     - All referenced source files exist in the asset manifest
     - All segment IDs are unique
     - Durations are positive numbers
     - Processor values are valid: "ffmpeg" | "runway" | "elevenlabs"
     - Required fields present per segment type (intro needs source, generated needs prompt, before_after needs left+right)
     - Output formats in project.outputFormats are valid preset names (load from formats.yaml)
     - Audio sources exist or have prompts for AI generation
     - Thumbnail config references valid sources
   - Warnings (non-blocking):
     - Total timeline duration differs from targetDurationSeconds by more than 10%
     - Segments with no textOverlay (might be intentional)
     - Missing cropHints for vertical format outputs

2. src/edl/translator.ts
   - Export: function translateEDL(edl: EDL, projectDir: string, formats: string[]): ProcessingStep[]
   - Takes a validated EDL and produces an ordered list of ProcessingStep objects
   - Each step maps to a concrete operation: ffmpeg command args, API call params, etc.
   - Step ordering:
     a. Per-segment render steps (one per timeline segment)
     b. Composite step (concat all rendered segments)
     c. Audio mix step
     d. Text overlay steps
     e. Final master encode (YouTube format)
     f. Reformat steps — one per additional output format (these can run in parallel)
     g. Thumbnail generation step
   - Each ProcessingStep includes input/output file paths using projectDir conventions:
     - Rendered segments: {projectDir}/rendered/seg_{id}.mp4
     - Composite: {projectDir}/rendered/composite.mp4
     - Master: {projectDir}/output/youtube/{title}_{resolution}_{fps}fps.mp4
     - Format variants: {projectDir}/output/{format}/{title}_{resolution}_{fps}fps.mp4
   - Include estimatedCost for cloud API steps (Runway ~$0.05/sec, ElevenLabs ~20 credits/sec)

Write tests in src/edl/__tests__/validator.test.ts and src/edl/__tests__/translator.test.ts using vitest:
- Test validation catches missing assets, invalid processors, duplicate IDs
- Test validation passes on a well-formed EDL
- Test translator produces correct step ordering
- Test translator generates reformat steps for each requested output format
- Test file path generation follows conventions

Commit to the feature branch when done.
```

### CC-P2-02: Inngest Pipeline

```
You are working on the Splicewerk project — an AI-driven video production framework.

Read docs/splicewerk-implementation-handoff.md for full context — especially the Inngest Pipeline Detail section and the code example. You are executing task CC-P2-02.

Create a new branch: git checkout -b feat/CC-P2-02-inngest-pipeline

Build the Inngest orchestration layer:

1. src/inngest/client.ts
   - Create and export the Inngest client instance
   - App ID: "splicewerk"
   - Load INNGEST_EVENT_KEY from env

2. src/inngest/functions/produce-video.ts
   - Export the main pipeline function triggered by event: "video/production-requested"
   - Event data shape: { userPrompt: string, assetPaths: string, outputFormats: string[], projectName: string }
   - Pipeline steps (each wrapped in step.run):
     a. "catalog-assets" — call catalogAssets() from asset-catalog service
     b. "generate-edl" — call generateEDL() from llm service
     c. "validate-edl" — call validateEDL() from validator
     d. "handle-missing-assets" — if edl.missingAssets has required items, notify and use step.waitForEvent("video/assets-provided", { timeout: "7d" }). After receiving, re-catalog and re-generate EDL.
     e. "translate-edl" — call translateEDL() to get processing steps
     f. "render-segments" — loop over processing steps of type segment render. Each gets its own step.run with ID "render-{segmentId}". Dispatch to the appropriate service based on processor type.
     g. "composite" — call ffmpeg.concatClips on all rendered segments
     h. "audio-mix" — call ffmpeg.mixAudio with background music and original audio per EDL
     i. "add-text-overlays" — apply text overlays per EDL segments that have them
     j. "finalize-master" — final encode at YouTube format preset
     k. "reformat-outputs" — for each additional output format, call ffmpeg.reformat (these could be individual steps for retry isolation)
     l. "generate-thumbnail" — call thumbnail service
   - Return: { video: masterPath, formats: formatPaths, thumbnail: thumbnailPath, edl: edl, costs: totalCosts }

3. inngest.config.ts
   - Import the Inngest client and the produce-video function
   - Export the serve configuration
   - For local dev, serve on /api/inngest

4. src/inngest/functions/helpers.ts
   - Helper to dispatch a processing step to the correct service:
     export async function executeStep(step: ProcessingStep): Promise<string>
   - Routes based on step.type: ffmpeg → ffmpeg service, runway → runway service, elevenlabs → elevenlabs service, sharp → thumbnail service, reformat → ffmpeg.reformat

Import types from src/edl/types.ts and services from src/services/*.

Write tests in src/inngest/__tests__/produce-video.test.ts using vitest:
- Test pipeline step ordering
- Test missing assets triggers waitForEvent
- Test executeStep routing logic
- Mock all service calls

Commit to the feature branch when done.
```

### CC-P2-03: CLI Interface

```
You are working on the Splicewerk project — an AI-driven video production framework.

Read docs/splicewerk-implementation-handoff.md for full context. You are executing task CC-P2-03.

Create a new branch: git checkout -b feat/CC-P2-03-cli

Build src/cli/index.ts — the command-line interface for Splicewerk.

Use the "commander" package (add via pnpm add commander).

Commands:

1. splicewerk produce --prompt "..." --assets ./path/ --formats youtube,instagram-reels,tiktok [--project-name my-project] [--dry-run]
   - Creates a project directory under projects/{project-name}/ with subdirs: raw/, prepared/, rendered/, output/
   - Copies or symlinks assets from --assets into projects/{name}/raw/
   - If --dry-run: catalog assets, generate EDL, validate, print EDL to stdout, and exit (no rendering)
   - If not dry-run: emit Inngest event "video/production-requested" with the data
   - Default formats: youtube (if --formats not specified)
   - Auto-generate project-name from prompt if not provided (slugify first few words)
   - Load .env via dotenv at startup

2. splicewerk catalog --assets ./path/
   - Catalogs assets and prints the manifest as formatted JSON to stdout
   - Useful for inspecting what the LLM will see

3. splicewerk formats
   - Loads src/config/formats.yaml and prints all available format presets as a table
   - Columns: name, label, resolution, aspect ratio, max duration

4. splicewerk status [--project <name>]
   - If Inngest is running, query for the status of the latest (or named) project run
   - For MVP: just check if output files exist in the project directory and report

5. splicewerk provide --project <name> --assets ./new-assets/
   - For the human-in-the-loop flow — sends the "video/assets-provided" event to Inngest
   - Copies new assets into the project's raw/ directory

Global options:
- --verbose / -v: enable debug logging
- --config: path to channel.yaml (default: src/config/channel.yaml)

Update package.json:
- Add "bin": { "splicewerk": "./dist/cli/index.js" }
- Update "produce" script to: "tsx src/cli/index.ts produce"

Write tests in src/cli/__tests__/cli.test.ts using vitest:
- Test argument parsing for each command
- Test project directory creation
- Test --dry-run flag skips event emission
- Test formats command output
- Test slugification of project names

Commit to the feature branch when done.
```

---

## Phase 3: Runway Integration (1 agent, after Phase 2)

### CC-P3-01: Runway Service

```
You are working on the Splicewerk project — an AI-driven video production framework.

Read docs/splicewerk-implementation-handoff.md for full context. You are executing task CC-P3-01.

Create a new branch: git checkout -b feat/CC-P3-01-runway-service

Build src/services/runway.ts — integration with Runway's API for generative video.

Use the @runwayml/sdk package (already installed).

Implement:

1. async function imageToVideo(imagePath: string, prompt: string, durationSeconds: number, outputDir: string): Promise<string>
   - Upload image or provide URL
   - Create a gen4_turbo image-to-video task
   - Poll for completion (check every 10 seconds, timeout after 5 minutes)
   - Download the output video to outputDir
   - Return local file path
   - Log estimated cost: durationSeconds * 5 credits (Gen-4 Turbo rate)

2. async function textToVideo(prompt: string, durationSeconds: number, outputDir: string): Promise<string>
   - Create a gen4_turbo text-to-video task (no input image)
   - Poll and download same as above
   - Return local file path

3. async function editVideo(videoPath: string, editPrompt: string, outputDir: string): Promise<string>
   - Use Runway's Aleph model for video editing/transformation
   - Poll and download
   - Return local file path

4. Helper: async function pollTask(taskId: string, timeoutMs: number): Promise<TaskResult>
   - Generic polling function that checks task status every 10 seconds
   - Throws on timeout or failure
   - Returns the completed task result with output URLs

5. Helper: async function downloadOutput(url: string, outputPath: string): Promise<string>
   - Downloads a video file from Runway's CDN to local path
   - Returns the local path

Internal details:
- Use RUNWAY_API_KEY from env
- Initialize RunwayML client: new RunwayML({ apiKey: process.env.RUNWAY_API_KEY })
- Track costs per call in a running total
- Export function getCostSummary(): { totalCredits: number, estimatedCostUSD: number }

Write tests in src/services/__tests__/runway.test.ts using vitest:
- Mock the RunwayML SDK
- Test imageToVideo creates task and polls correctly
- Test timeout handling
- Test download to local path
- Test cost tracking accumulation

Commit to the feature branch when done.
```

---

## Phase 4: Polish (2 agents in parallel, after Phase 2)

### CC-P4-01: Thumbnail Generator

```
You are working on the Splicewerk project — an AI-driven video production framework.

Read docs/splicewerk-implementation-handoff.md for full context. You are executing task CC-P4-01.

Create a new branch: git checkout -b feat/CC-P4-01-thumbnail-generator

Build src/services/thumbnail.ts using the Sharp library for image processing.

Implement:

1. async function generateThumbnail(config: ThumbnailConfig, channelConfig: ChannelConfig, projectDir: string): Promise<string>
   - Dispatches to the appropriate style function based on config.type
   - Returns the output file path (always 1280x720 JPG)

2. async function beforeAfterSplit(leftFramePath: string, rightFramePath: string, text: string, style: ThumbnailStyle, outputPath: string): Promise<string>
   - Extract frames from video at specified timestamps using ffmpeg.extractFrame
   - Create a 1280x720 canvas
   - Place left image on left half, right image on right half
   - Draw a colored divider line in the center (color and width from style)
   - Add "BEFORE" label on left, "AFTER" label on right
   - Add main text overlay (title) with stroke/shadow
   - Apply channel branding (logo watermark if configured)
   - Save as JPG at quality 95

3. async function singleFrame(framePath: string, text: string, style: ThumbnailStyle, outputPath: string): Promise<string>
   - Extract frame, resize to 1280x720
   - Add text overlay with configurable font, size, color, stroke
   - Apply branding
   - Save as JPG

4. async function collage(framePaths: string[], text: string, style: ThumbnailStyle, outputPath: string): Promise<string>
   - Arrange 2-4 frames in a grid layout on 1280x720 canvas
   - Add text overlay
   - Apply branding

Helper: async function extractVideoFrame(videoPath: string, timestampSeconds: number, outputPath: string): Promise<string>
   - Wraps ffmpeg -ss {time} -i {input} -vframes 1 -q:v 2 {output}

Use Sharp for all image composition:
- sharp().resize(), .composite(), .toFile()
- For text rendering, use Sharp's SVG text overlay approach (create an SVG with the text, composite it onto the image)

Import ThumbnailConfig and related types from src/edl/types.ts.
Import channel config types and loader from src/config/channel.ts (if available, otherwise define inline).

Write tests in src/services/__tests__/thumbnail.test.ts using vitest:
- Test frame extraction command construction (mock ffmpeg)
- Test that beforeAfterSplit produces correct Sharp pipeline
- Test text overlay SVG generation
- Test output dimensions are always 1280x720

Commit to the feature branch when done.
```

### CC-P4-02: Channel Config & Music Library

```
You are working on the Splicewerk project — an AI-driven video production framework.

Read docs/splicewerk-implementation-handoff.md and docs/splicewerk-framework-plan.md (channel.yaml section) for full context. You are executing task CC-P4-02.

Create a new branch: git checkout -b feat/CC-P4-02-channel-config

Build the configuration system:

1. src/config/channel.ts
   - Define TypeScript interfaces for the full channel config: ChannelConfig, BrandingConfig, IntroConfig, OutroConfig, DefaultsConfig, TextStyleConfig, ThumbnailStyleConfig, MusicLibraryConfig, MusicTrack
   - Export: function loadChannelConfig(configPath?: string): ChannelConfig
     - Loads and parses channel.yaml
     - Validates required fields exist (channel.name, branding.primary_color, defaults.resolution)
     - Validates referenced files exist (fonts, logos, intro template) — warn if missing, don't crash
     - Returns typed config
   - Export: function loadMusicLibrary(configPath?: string): MusicLibraryConfig
     - Loads and parses music-library.yaml
     - Returns typed config
   - Export: function selectMusic(library: MusicLibraryConfig, mood?: string, energy?: string, minDuration?: number): MusicTrack | null
     - Filters tracks by mood/energy tags
     - Filters by minimum duration
     - Returns the best match or null

2. src/config/channel.yaml (template with placeholder values)
   - Use the full channel.yaml template from docs/splicewerk-framework-plan.md
   - Replace channel name with "My Channel"
   - Include comments explaining each field
   - Reference font files in assets/fonts/ and logos in assets/logos/

3. src/config/music-library.yaml (template)
   ```yaml
   tracks:
     - file: "assets/music/upbeat_garage.mp3"
       title: "Garage Energy"
       mood: "energetic"
       energy: "high"
       genre: "rock"
       duration: 180
       source: "epidemic-sound"  # or "elevenlabs", "youtube-audio-library", "original"
       tags: ["build", "montage", "upgrade"]

     - file: "assets/music/chill_cruise.mp3"
       title: "Smooth Ride"
       mood: "chill"
       energy: "low"
       genre: "lo-fi"
       duration: 240
       source: "epidemic-sound"
       tags: ["driving", "cruise", "scenic"]

     - file: "assets/music/dramatic_reveal.mp3"
       title: "The Reveal"
       mood: "dramatic"
       energy: "medium"
       genre: "cinematic"
       duration: 120
       source: "epidemic-sound"
       tags: ["before-after", "reveal", "transformation"]
   ```

4. src/config/formats.ts
   - Export: function loadFormatPresets(configPath?: string): Record<string, FormatPreset>
     - Loads formats.yaml (already created in scaffold)
     - Returns a map of format name → FormatPreset
   - Export: function getFormatPreset(name: string): FormatPreset
     - Returns a specific format or throws if not found
   - Export: function listFormats(): { name: string, label: string, resolution: string, aspectRatio: string, maxDuration: number | null }[]
     - Returns a summary list for the CLI's "splicewerk formats" command

Write tests in src/config/__tests__/channel.test.ts and src/config/__tests__/formats.test.ts using vitest:
- Test loading valid channel config
- Test validation catches missing required fields
- Test music selection filtering by mood and energy
- Test music selection returns null when no match
- Test format preset loading and listing
- Test getFormatPreset throws on unknown format name

Commit to the feature branch when done.
```

---

## Merge Order

After each phase completes:

```bash
# Phase 0 → merge to main
git checkout main && git merge feat/CC-P0-01-scaffold

# Phase 1 → merge each feature branch
git checkout main
git merge feat/CC-P1-01-asset-catalog
git merge feat/CC-P1-02-ffmpeg-service
git merge feat/CC-P1-03-llm-service
git merge feat/CC-P1-04-elevenlabs-service

# Phase 2 → merge each feature branch
git merge feat/CC-P2-01-edl-validator-translator
git merge feat/CC-P2-02-inngest-pipeline
git merge feat/CC-P2-03-cli

# Phase 3
git merge feat/CC-P3-01-runway-service

# Phase 4
git merge feat/CC-P4-01-thumbnail-generator
git merge feat/CC-P4-02-channel-config
```

---

## First Intro Clip Test (After Phase 2 + Phase 4 merge)

```bash
# 1. Start Ollama
ollama serve &

# 2. Start Inngest dev server (separate terminal)
pnpm inngest:dev

# 3. Put some raw clips in a project folder
mkdir -p projects/test-intro/raw
# Copy a few car clips/photos there

# 4. Run dry-run first to see the EDL
splicewerk produce \
  --prompt "Create a 15-second channel intro with dramatic car shots and our branding" \
  --assets ./projects/test-intro/raw/ \
  --formats youtube,instagram-reels \
  --dry-run

# 5. If EDL looks good, run for real
splicewerk produce \
  --prompt "Create a 15-second channel intro with dramatic car shots and our branding" \
  --assets ./projects/test-intro/raw/ \
  --formats youtube,instagram-reels
```
