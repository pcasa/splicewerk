# Splicewerk: AI-Driven Video Production Framework

## Project Overview

An AI-powered video production framework for a car-focused YouTube channel. The system accepts raw assets (video clips, photos, audio) plus a natural language prompt, then orchestrates the full editing pipeline — from analysis through final render — with minimal manual intervention.

The framework is interactive where needed: if the LLM determines it needs footage you haven't provided (e.g., "I need a 5-second clip of the finished wheel from the driver side"), it pauses the workflow and asks before continuing.

**Example prompt:**
> "Make a 3-minute video showing the brake upgrade on the Civic. Use the before clips first, then the install process, then the after shots. Add the channel intro, background music, and text overlays for each section. Generate a thumbnail with the before/after comparison."

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                             │
│              CLI (MVP)  →  Web UI (future)                        │
│     Drop assets + write prompt → get finished video               │
└───────────┬──────────────────────────────────────────────┬───────┘
            │ prompt + asset manifest                      │ status / "need more" requests
            ▼                                              ▲
┌──────────────────────────────────────────────────────────────────┐
│                      BRAIN (LLM Layer)                            │
│               Nemotron 3 Super (:cloud via Ollama)                │
│                                                                   │
│  1. Analyze asset metadata (durations, resolutions, content)      │
│  2. Interpret prompt into structured Edit Decision List (JSON)    │
│  3. Identify gaps → pause & request missing footage               │
│  4. Select music/effects from library                             │
│  5. Decide which processing engine handles each step              │
│     (FFmpeg for deterministic work, Cloud AI for generative)      │
└───────────┬──────────────────────────────────────────────────────┘
            │ structured EDL (JSON)
            ▼
┌──────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR (Inngest)                          │
│              Self-hosted  or  Inngest Cloud free tier              │
│                                                                   │
│  • Durable step execution with per-step retry                     │
│  • step.waitForEvent() for human-in-the-loop (asset requests)     │
│  • Parallel processing where possible                             │
│  • Status events back to CLI/UI                                   │
│                                                                   │
│  Pipeline:                                                        │
│    catalog-assets → llm-generate-edl → validate-edl →             │
│    [request-missing-assets?] → prepare-assets →                   │
│    [parallel: local-renders + cloud-ai-generations] →             │
│    composite → add-audio → add-text/captions →                    │
│    finalize → generate-thumbnail                                  │
└───────────┬────────────────────┬─────────────────────────────────┘
            │ local               │ cloud API calls
            ▼                     ▼
┌─────────────────────┐  ┌────────────────────────────────────────┐
│  LOCAL PROCESSING    │  │  CLOUD AI PROCESSING                   │
│                      │  │                                        │
│  FFmpeg              │  │  Runway API                            │
│  • trim, concat      │  │  • stylized transitions                │
│  • split-screen      │  │  • image-to-video (stills → B-roll)   │
│  • audio mix         │  │  • background removal (no greenscreen) │
│  • encode/export     │  │  • Aleph (video editing/transforms)    │
│                      │  │                                        │
│  Sharp / ImageMagick │  │  Kling AI API                          │
│  • thumbnails        │  │  • AI intro/outro generation           │
│  • frame extraction  │  │  • photo-to-cinematic-clip             │
│                      │  │  • effects & style transfer            │
│  (future) Final Cut  │  │                                        │
│  Pro (FCPXML export  │  │  Descript (optional)                   │
│  for manual polish)  │  │  • transcript-based audio cleanup      │
│                      │  │  • filler word removal                 │
│                      │  │  • auto-captioning                     │
└─────────────────────┘  └────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Cost | Role |
|-------|-----------|------|------|
| **LLM (brain)** | Nemotron 3 Super `:cloud` via Ollama | Free | Prompt interpretation, EDL generation, asset gap analysis |
| **Orchestration** | Inngest (self-hosted or cloud) | Free tier | Durable pipeline execution, retry, human-in-the-loop |
| **Runtime** | Node.js / TypeScript | Free | Inngest SDK, API integrations, CLI |
| **Local video** | FFmpeg (CLI or fluent-ffmpeg) | Free | Trim, concat, split-screen, audio mix, encode |
| **Local image** | Sharp (Node.js) | Free | Thumbnail generation, frame extraction |
| **Cloud video gen** | Runway API | Pay-per-use (~$0.05/sec) | Transitions, image-to-video, style effects, bg removal |
| **Cloud video gen** | Kling AI API | Pay-per-use (~$0.035/video) | AI-generated intros, photo-to-cinematic-clip |
| **Cloud audio** | Descript (optional) | Free tier available | Transcript editing, audio cleanup, captions |
| **Manual polish** | Final Cut Pro (optional) | $299.99 one-time | Manual override for final tweaks via FCPXML import |
| **Asset storage** | Local filesystem (structured) | Free | Privacy, no cloud dependency |
| **Config** | YAML files | Free | Channel branding, music library, templates |

---

## LLM Integration: How Nemotron 3 Super Fits

### Connection

Ollama exposes an OpenAI-compatible API at `http://localhost:11434/v1` (local) or via NVIDIA's cloud endpoint when using `:cloud`. The framework calls this API with structured system prompts that instruct the model to output JSON EDLs.

### What the LLM Decides

Given a user prompt + asset metadata, the LLM produces a structured Edit Decision List:

```json
{
  "project": {
    "title": "Civic Brake Upgrade",
    "target_duration_seconds": 180,
    "aspect_ratio": "16:9",
    "resolution": "1920x1080"
  },
  "missing_assets": [
    {
      "description": "5-second clip of finished brake assembly, driver side angle",
      "purpose": "closing shot for the after section",
      "priority": "required"
    }
  ],
  "timeline": [
    {
      "id": "seg_01",
      "type": "intro",
      "source": "channel_intro.mp4",
      "processor": "ffmpeg",
      "operations": ["trim:0-5"]
    },
    {
      "id": "seg_02",
      "type": "title_card",
      "processor": "runway",
      "operation": "image_to_video",
      "source_image": "civic_front.jpg",
      "prompt": "Slow cinematic pan across a Honda Civic in a garage, warm lighting",
      "duration_seconds": 4,
      "text_overlay": {
        "text": "BRAKE UPGRADE",
        "position": "center",
        "style": "channel_title"
      }
    },
    {
      "id": "seg_03",
      "type": "before_after",
      "processor": "ffmpeg",
      "operation": "split_screen",
      "left": { "source": "before_brakes.mp4", "trim": "0:02-0:08" },
      "right": { "source": "after_brakes.mp4", "trim": "0:01-0:07" },
      "text_overlay": {
        "left_label": "BEFORE",
        "right_label": "AFTER"
      }
    },
    {
      "id": "seg_04",
      "type": "montage",
      "processor": "ffmpeg",
      "clips": [
        { "source": "install_01.mp4", "trim": "0:05-0:15" },
        { "source": "install_02.mp4", "trim": "0:00-0:12" },
        { "source": "install_03.mp4", "trim": "0:03-0:10" }
      ],
      "transition": "crossfade:0.5s"
    }
  ],
  "audio": {
    "background_music": {
      "source": "music_library/upbeat_garage.mp3",
      "volume": 0.15,
      "fade_in": 2,
      "fade_out": 3
    },
    "original_audio": {
      "segments": ["seg_04"],
      "volume": 0.85
    }
  },
  "thumbnail": {
    "type": "before_after_split",
    "left_frame": { "source": "before_brakes.mp4", "timestamp": "0:04" },
    "right_frame": { "source": "after_brakes.mp4", "timestamp": "0:03" },
    "text": "BRAKE UPGRADE!",
    "style": "channel_thumbnail"
  }
}
```

### What the LLM Does NOT Do

The LLM never generates FFmpeg commands directly. It produces the declarative EDL, and the processing layer translates that into concrete commands. This keeps the LLM focused on creative decisions and prevents hallucinated CLI flags from breaking renders.

---

## Inngest Pipeline Detail

### Why Inngest Over n8n

- **Durable execution**: each `step.run()` is retried independently. If a 10-minute FFmpeg render fails on step 6 of 8, it resumes from step 6.
- **Human-in-the-loop**: `step.waitForEvent('asset-provided')` pauses the workflow until you provide missing footage, then resumes exactly where it left off.
- **Code-first**: workflows are TypeScript functions in your codebase, not visual graphs. Easier to version control, test, and debug.
- **Self-hostable**: runs on your Mac via Docker, free. Or use Inngest Cloud's free tier (up to 5,000 runs/month).
- **No queue infrastructure**: no Redis, no RabbitMQ, no SQS.

### Core Workflow

```typescript
// workflows/produce-video.ts
import { inngest } from '../inngest-client';

export const produceVideo = inngest.createFunction(
  { id: 'produce-video', name: 'Produce Video from Prompt' },
  { event: 'video/production-requested' },
  async ({ event, step }) => {

    // Step 1: Catalog assets — extract metadata via ffprobe
    const assetManifest = await step.run('catalog-assets', async () => {
      return catalogAssets(event.data.assetPaths);
    });

    // Step 2: Generate EDL via Nemotron 3 Super
    const edl = await step.run('generate-edl', async () => {
      return callNemotron({
        prompt: event.data.userPrompt,
        assets: assetManifest,
        channelConfig: loadChannelConfig(),
      });
    });

    // Step 3: Handle missing assets (human-in-the-loop)
    if (edl.missing_assets.length > 0) {
      // Notify user what's needed
      await step.run('request-missing-assets', async () => {
        return notifyUser(edl.missing_assets);
      });

      // Pause workflow until assets are provided
      const provided = await step.waitForEvent(
        'wait-for-assets',
        { event: 'video/assets-provided', timeout: '7d' }
      );

      // Re-catalog with new assets and regenerate EDL
      // ...
    }

    // Step 4: Prepare assets (normalize resolution, frame rate)
    const preparedAssets = await step.run('prepare-assets', async () => {
      return normalizeAssets(edl, assetManifest);
    });

    // Step 5: Process segments (parallel where possible)
    const renderedSegments = [];
    for (const segment of edl.timeline) {
      const rendered = await step.run(
        `render-${segment.id}`,
        async () => {
          if (segment.processor === 'ffmpeg') {
            return processWithFFmpeg(segment, preparedAssets);
          } else if (segment.processor === 'runway') {
            return processWithRunway(segment, preparedAssets);
          } else if (segment.processor === 'kling') {
            return processWithKling(segment, preparedAssets);
          }
        }
      );
      renderedSegments.push(rendered);
    }

    // Step 6: Composite all segments into final timeline
    const composited = await step.run('composite', async () => {
      return compositeSegments(renderedSegments, edl);
    });

    // Step 7: Audio mix
    const withAudio = await step.run('audio-mix', async () => {
      return mixAudio(composited, edl.audio);
    });

    // Step 8: Text overlays & captions
    const withText = await step.run('add-text', async () => {
      return addTextOverlays(withAudio, edl);
    });

    // Step 9: Final encode
    const finalVideo = await step.run('finalize', async () => {
      return finalEncode(withText, edl.project);
    });

    // Step 10: Generate thumbnail
    const thumbnail = await step.run('generate-thumbnail', async () => {
      return generateThumbnail(edl.thumbnail);
    });

    // Step 11: (Optional) Export FCPXML for Final Cut Pro polish
    const fcpxml = await step.run('export-fcpxml', async () => {
      return exportToFCPXML(edl, renderedSegments);
    });

    return {
      video: finalVideo,
      thumbnail: thumbnail,
      fcpxml: fcpxml,
      edl: edl,
    };
  }
);
```

---

## Cloud AI Tool Integration

### Runway API

**Best for:** Stylized transitions, image-to-video B-roll, background removal, video transforms.

**Why Runway specifically:** They have an MCP server on GitHub, so it can connect directly to Claude or any MCP-compatible agent. Their API supports Gen-4.5 for text/image-to-video, Aleph for editing/transforming existing videos, and Act-Two for motion capture transfer.

```typescript
// services/runway.ts
import RunwayML from '@runwayml/sdk';

const runway = new RunwayML(); // API key via env var

async function processWithRunway(segment: TimelineSegment, assets: PreparedAssets) {
  if (segment.operation === 'image_to_video') {
    const task = await runway.imageToVideo.create({
      model: 'gen4_turbo',
      promptImage: assets.getUrl(segment.source_image),
      promptText: segment.prompt,
      duration: segment.duration_seconds,
      ratio: '1280:768',
    });

    // Poll for completion
    let result;
    do {
      await new Promise(r => setTimeout(r, 10000));
      result = await runway.tasks.retrieve(task.id);
    } while (!['SUCCEEDED', 'FAILED'].includes(result.status));

    if (result.status === 'SUCCEEDED') {
      return downloadToLocal(result.output[0], segment.id);
    }
    throw new Error(`Runway generation failed: ${result.failure}`);
  }
}
```

**Cost estimate for typical video:** 2-3 AI-generated clips × 5 seconds each × ~$0.05/sec = ~$0.50-$0.75 per video.

### Kling AI API

**Best for:** Generating cinematic clips from still photos (car photos → short dramatic reveal clips), AI-generated channel intros. Kling 3.0 is a unified multimodal model generating video, audio, and images within a single architecture.

```typescript
// services/kling.ts
async function processWithKling(segment: TimelineSegment, assets: PreparedAssets) {
  const response = await fetch('https://api.klingai.com/v1/videos/text2video', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.KLING_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'kling-v3',
      prompt: segment.prompt,
      image_url: segment.source_image ? assets.getUrl(segment.source_image) : undefined,
      duration: segment.duration_seconds,
      aspect_ratio: '16:9',
      mode: 'pro',
    }),
  });

  const task = await response.json();
  return pollForCompletion(task.task_id, segment.id);
}
```

### Descript (Optional — Manual Step)

Descript doesn't have a fully open programmatic API, but fits the workflow as:
1. **Audio cleanup**: send narration segments through Descript's Studio Sound
2. **Transcript editing**: for voiceover-heavy videos, edit in Descript first, feed cleaned audio back
3. **Auto-captioning**: export captions for cleanup

For the MVP, we handle captions via Whisper (free, local) and audio cleanup via FFmpeg filters, keeping Descript as a manual polish option.

---

## Processing Engines: What Goes Where

| Task | Engine | Why |
|------|--------|-----|
| Trim clips to timestamps | FFmpeg | Deterministic, instant, free |
| Concatenate clips in order | FFmpeg | Deterministic, free |
| Split-screen comparison | FFmpeg | Filter complex, precise layout control |
| Crossfade transitions | FFmpeg | `xfade` filter, free |
| Audio mixing (music + original) | FFmpeg | `amix`/`amerge` filters, free |
| Text overlays (titles, labels) | FFmpeg `drawtext` or Sharp | Free, precise positioning |
| Final H.264/H.265 encode | FFmpeg + VideoToolbox | Hardware accelerated on Apple Silicon |
| Thumbnail from frame | Sharp | Fast, Node.js native |
| Stylized AI transitions | Runway API | Generative, cinematic quality |
| Still photo → cinematic clip | Runway or Kling API | AI motion from static image |
| AI-generated intro sequence | Kling API | Style-consistent intro generation |
| Background removal | Runway API | No greenscreen needed |
| Voiceover cleanup | Descript or FFmpeg filters | Filler removal, noise reduction |
| Auto-captions/subtitles | Whisper (local) or Descript | Free locally via whisper.cpp |
| Manual final polish | Final Cut Pro (via FCPXML) | Creative override when needed |

---

## Project Structure

```
splicewerk/
├── src/
│   ├── cli/                    # CLI entry point
│   │   └── index.ts            # Parse prompt + asset paths, emit Inngest event
│   ├── inngest/
│   │   ├── client.ts           # Inngest client config
│   │   └── functions/
│   │       ├── produce-video.ts    # Main pipeline function
│   │       └── generate-thumbnail.ts
│   ├── services/
│   │   ├── llm.ts              # Nemotron API calls (Ollama OpenAI-compat)
│   │   ├── ffmpeg.ts           # FFmpeg command builder + executor
│   │   ├── runway.ts           # Runway API integration
│   │   ├── kling.ts            # Kling API integration
│   │   ├── whisper.ts          # Local captioning via whisper.cpp
│   │   └── sharp.ts            # Image processing (thumbnails)
│   ├── edl/
│   │   ├── types.ts            # EDL TypeScript types/interfaces
│   │   ├── validator.ts        # Validate LLM-generated EDL
│   │   └── translator.ts       # EDL → FFmpeg commands
│   ├── config/
│   │   ├── channel.yaml        # Channel branding (intro, outro, fonts, colors)
│   │   └── music-library.yaml  # Available background music tracks
│   └── utils/
│       ├── asset-catalog.ts    # ffprobe metadata extraction
│       ├── download.ts         # Download cloud AI outputs to local
│       └── fcpxml-export.ts    # Export to Final Cut Pro XML
├── assets/
│   ├── intros/                 # Pre-made intro templates
│   ├── outros/                 # Pre-made outro templates
│   ├── music/                  # Background music library
│   ├── fonts/                  # Custom fonts for overlays
│   └── logos/                  # Channel logos/watermarks
├── projects/                   # Per-project working directories
│   └── civic-brakes-2024/
│       ├── raw/                # Raw input assets
│       ├── prepared/           # Normalized assets
│       ├── rendered/           # Per-segment renders
│       ├── output/             # Final video + thumbnail
│       └── edl.json            # Generated EDL
├── inngest.config.ts           # Inngest serve config
├── package.json
├── tsconfig.json
└── README.md
```

---

## Channel Configuration (channel.yaml)

```yaml
channel:
  name: "[Your Channel Name]"
  tagline: "Car builds, upgrades, and repairs"

branding:
  primary_color: "#FF4444"
  secondary_color: "#1A1A1A"
  font_title: "fonts/BebasNeue-Bold.ttf"
  font_body: "fonts/Montserrat-Medium.ttf"
  logo: "logos/channel_logo.png"
  watermark:
    file: "logos/watermark.png"
    position: "bottom_right"
    opacity: 0.3

intro:
  template: "intros/default_intro.mp4"
  duration_seconds: 5
  # OR generate dynamically:
  # generate: true
  # style: "cinematic garage reveal"

outro:
  template: "outros/default_outro.mp4"
  duration_seconds: 8
  subscribe_cta: true

defaults:
  resolution: "1920x1080"
  frame_rate: 30
  aspect_ratio: "16:9"
  codec: "h264"
  quality: "high"  # maps to FFmpeg CRF 18

text_styles:
  channel_title:
    font: "fonts/BebasNeue-Bold.ttf"
    size: 72
    color: "#FFFFFF"
    shadow: true
    position: "center"
  section_label:
    font: "fonts/Montserrat-Medium.ttf"
    size: 36
    color: "#FF4444"
    background: "rgba(0,0,0,0.7)"
    position: "lower_third"
  before_after_label:
    font: "fonts/BebasNeue-Bold.ttf"
    size: 48
    color: "#FFFFFF"
    background: "rgba(0,0,0,0.5)"
    position: "top_center"

thumbnail_styles:
  before_after_split:
    divider_color: "#FF4444"
    divider_width: 6
    text_font: "fonts/BebasNeue-Bold.ttf"
    text_size: 96
    text_color: "#FFFFFF"
    text_stroke: "#000000"
    text_stroke_width: 4

music_library:
  default_volume: 0.15
  fade_in_seconds: 2
  fade_out_seconds: 3
```

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
- [ ] Project scaffolding (TypeScript, Inngest setup)
- [ ] Asset cataloging service (ffprobe metadata extraction)
- [ ] Nemotron 3 Super `:cloud` integration via Ollama
- [ ] EDL type system and validator
- [ ] Basic FFmpeg service (trim, concat, encode)
- [ ] CLI that takes a prompt + asset folder and produces an EDL

**Milestone:** Given raw clips + prompt, outputs a valid EDL JSON.

### Phase 2: Local Pipeline (Weeks 3-4)
- [ ] EDL → FFmpeg command translator
- [ ] Split-screen composite implementation
- [ ] Audio mixing (background music + original audio)
- [ ] Text overlay rendering (titles, section labels, before/after)
- [ ] Thumbnail generation via Sharp
- [ ] Inngest pipeline wiring (full local render flow)
- [ ] Channel config system (YAML branding)

**Milestone:** Produces a complete video from raw clips using FFmpeg only.

### Phase 3: Cloud AI Integration (Weeks 5-6)
- [ ] Runway API integration (image-to-video, transitions)
- [ ] Kling AI API integration (intro generation, photo-to-clip)
- [ ] Cloud output download + integration into local pipeline
- [ ] LLM decides which processor handles each segment
- [ ] Cost tracking per cloud API call

**Milestone:** Videos include AI-generated B-roll and transitions mixed with real footage.

### Phase 4: Human-in-the-Loop & Polish (Weeks 7-8)
- [ ] `step.waitForEvent()` for missing asset requests
- [ ] FCPXML export for Final Cut Pro handoff
- [ ] Whisper integration for auto-captioning
- [ ] Subtitle burn-in or SRT export
- [ ] Progress notifications (terminal or webhook)
- [ ] Project history and re-render from modified EDL

**Milestone:** Full interactive workflow — framework asks for missing clips, waits, then completes.

### Phase 5: Future Enhancements
- [ ] Web UI (React) for drag-and-drop assets + prompt input
- [ ] Template system (e.g., "before-after-upgrade" template)
- [ ] Batch processing (multiple videos from one session)
- [ ] YouTube API integration (upload, set title/description/thumbnail)
- [ ] Voice cloning for consistent narration style
- [ ] Local Nemotron 3 Nano for offline/fast tasks (if hardware upgrade)

---

## Cost Analysis: Per-Video Estimate

| Component | Cost |
|-----------|------|
| Nemotron 3 Super (cloud via Ollama) | $0.00 |
| FFmpeg (all local processing) | $0.00 |
| Inngest (self-hosted or free tier) | $0.00 |
| Sharp / Whisper (local) | $0.00 |
| Runway API (2-3 generated clips, ~15s total) | ~$0.75 |
| Kling API (1 intro clip, ~5s) | ~$0.15 |
| **Total per video (with cloud AI)** | **~$0.90** |
| **Total per video (FFmpeg-only mode)** | **$0.00** |

The framework tracks costs per project and lets you set a budget ceiling in the channel config.

---

## Key Design Decisions

### 1. LLM produces EDL, not commands
The LLM outputs a declarative JSON structure describing *what* should happen. A separate translator layer converts that into FFmpeg commands, Runway API calls, etc. This prevents hallucinated CLI flags and makes the pipeline testable.

### 2. FFmpeg as backbone, Cloud AI as enhancement
Every video can be produced with FFmpeg alone (zero cost). Cloud AI tools are additive — they make the output better but are never required. This means the framework works offline and without any API keys.

### 3. Inngest for orchestration, not a visual workflow builder
Code-first workflows are version-controlled, testable, and debuggable. The human-in-the-loop pattern (`waitForEvent`) is native to Inngest and doesn't require custom queue infrastructure.

### 4. FCPXML as escape hatch
If the automated output is 90% right but needs a tweak, export to Final Cut Pro via FCPXML rather than rebuilding the whole pipeline for edge cases.

### 5. Channel config is declarative
Branding, fonts, colors, intro/outro, music preferences — all in YAML. Change the config, and every future video reflects the new branding without code changes.

### 6. Cloud AI tools are swappable
The EDL uses `processor: "runway"` or `processor: "kling"` — adding a new cloud AI tool (e.g., Google Veo, Sora) means implementing one new service adapter. The LLM and orchestration layers don't change.

---

## Hardware Requirements (Current Setup — Cloud Mode)

| Requirement | Minimum | Notes |
|-------------|---------|-------|
| Mac with Apple Silicon | M1 or newer | VideoToolbox HW accel for FFmpeg |
| RAM | 8GB+ | 16GB preferred for parallel FFmpeg tasks |
| Storage | 50GB free | Raw footage + renders accumulate quickly |
| Internet | Required | For cloud LLM + cloud AI APIs |
| Ollama | Latest version | For Nemotron cloud routing |
| FFmpeg | 6.x+ with VideoToolbox | `brew install ffmpeg` |
| Node.js | 20 LTS+ | For Inngest + TypeScript runtime |
| Docker (optional) | Latest | For self-hosted Inngest server |

---

## Getting Started (After Planning)

```bash
# 1. Install prerequisites
brew install ffmpeg node ollama

# 2. Pull Nemotron (cloud mode — no large download)
ollama pull nemotron-3-super:cloud

# 3. Scaffold project
mkdir splicewerk && cd splicewerk
npm init -y
npm install typescript inngest @runwayml/sdk sharp fluent-ffmpeg yaml
npx tsc --init

# 4. Start Inngest dev server
npx inngest-cli@latest dev

# 5. First run (Phase 1 target)
npx ts-node src/cli/index.ts \
  --prompt "Make a 2-minute before/after brake upgrade video" \
  --assets ./projects/civic-brakes/raw/
```
