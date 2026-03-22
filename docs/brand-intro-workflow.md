# Brand Intro Workflow

A step-based pipeline for generating cinematic brand logo reveal videos using AI services.

---

## Pipeline Overview

```
Step 1: Asset Prep   →  Step 2: Audio   →  Step 3: Visual FX   →  Step 4: Assemble
  (sharp, free)          (ffmpeg/local)      (Runway Gen-4)          (Shotstack)
  ~2 seconds             ~5 seconds          ~60 seconds             ~30 seconds
  $0                     $0                  ~50-125 credits         ~$0.10
```

Each step produces a cached file. Re-runs skip steps whose output already exists.
Use `--force` to regenerate everything, or `--force-step <name>` to redo a single step.

---

## Step 1 — Asset Preparation

**Service:** `sharp` (local, no API)
**Cost:** $0
**Input:** `projects/<project>/raw/<logo>.png`
**Output:** `projects/<project>/output/logo-on-black.jpg`

### What it does
1. Samples the background color from the top-left pixel
2. Removes matching pixels (within tolerance) → transparent PNG
3. Scales and sharpens the logo
4. Composites it centered on a pure black canvas (1920×1080)

### Why pure black
Runway Gen-4 reads the image to determine the "subject" (the logo) and the "field" (the background).
Pure black gives Runway maximum contrast to detect logo edges and apply effects to the right areas.

### Tuning knobs
| Parameter | Default | Effect |
|---|---|---|
| `TOLERANCE` | 30 | Higher = removes more near-background pixels. Lower = tighter mask |
| Canvas size | 1920×1080 | Larger input = Runway has more detail to work with |
| Logo scale | 70% width | How large the logo is in frame |
| `sharpen.sigma` | 1.5 | Crispens edges so Runway detects them cleanly |

---

## Step 2 — Audio

**Services (priority order):**
1. **ffmpeg extract** — strip audio from existing project footage (free)
2. **Local file** — GarageBand export or manual download (free)
3. **ElevenLabs generate** — AI sound effect generation (costs credits)
4. **Free download** — CC0 audio from BigSoundBank (free, no API key)

**Cost:** $0 for options 1–2 and 4, ~6 credits/sec for ElevenLabs
**Input:** Source MOV/MP4 files OR local audio file
**Output:** `projects/<project>/output/engine.mp3`

### Source priority logic
```
existing_footage/*.MOV  →  extract best segment with ffmpeg
projects/raw/engine.mp3 →  use local file directly (GarageBand export)
ElevenLabs quota > 0    →  generate AI sound effect
bigsoundbank.com        →  download CC0 fallback
```

### Key insight: audio BEFORE visual effects
Audio generation is fast (~2–5 seconds) and cheap or free.
Runway generation is slow (~60 seconds) and costs real credits.
**Always generate and validate audio before sending anything to Runway.**
If audio fails, you know immediately without wasting a Runway generation.

### ElevenLabs credit math
- Free/starter plan: 100 credits/month
- Sound effects cost ~6 credits/second
- Max 10s clip = 60 credits (more than half the monthly free allotment)
- **Strategy:** Use extracted/local audio for development. Use ElevenLabs for final production only.

---

## Step 3 — Visual Effects (Runway Gen-4)

**Service:** Runway Gen-4 Turbo image-to-video
**Cost:** ~50 credits (5s) or ~125 credits (10s)
**Input:** `logo-on-black.jpg` + text prompt
**Output:** `projects/<project>/output/runway-logo.mp4`
**Duration:** ~55–70 seconds (API processing)

### Prompt strategy
The prompt is the single most important variable in this step.

**What works:**
- Specific colors (use hex codes: `#E02828 deep red`)
- Named effects (`light rays`, `electric sparks`, `molten metallic shimmer`, `smoke wisps`)
- Camera direction (`slow push-in`, `subtle zoom`)
- Brand reference (`AMG`, `Porsche`, `BMW M-series commercial`)
- Environment (`pure black background`, `pure darkness`)

**What doesn't work:**
- Generic phrases ("cinematic reveal", "cool effects")
- Asking for motion that fights the logo shape (don't ask for spinning, flipping)
- Long prompts over 1000 characters (Runway API limit)

**Proven baseline prompt for Autobahn Syndicate:**
```
Cinematic German automotive brand logo reveal on pure black background.
Dramatic deep red (#E02828) and turbo orange (#F46E2C) light rays burst outward from the logo text.
Electric sparks and embers drift across the letters.
A wave of molten metallic shimmer sweeps left to right across the wordmark.
Dark smoke wisps rise behind the logo. The camera slowly pushes in with subtle zoom.
Feels like a high-budget AMG, Porsche or BMW M-series commercial.
No background — just the logo glowing against pure darkness.
```

### LLM-generated prompts
The LLM can generate prompts for new brands. However, LLM-generated prompts tend to be
more generic than a hand-crafted prompt. Use LLM for first-pass exploration, then manually
refine the prompt that works best. Save proven prompts as named presets.

### Caching is critical
Each Runway generation costs real money. **Never regenerate if the output looks good.**
The pipeline caches `runway-logo.mp4` and skips this step on subsequent runs.
Only use `--force` when you intentionally want a new generation.

---

## Step 4 — Final Assembly (Shotstack)

**Service:** Shotstack Edit API (production v1)
**Cost:** ~$0.05–0.20 per render
**Input:** `runway-logo.mp4` + `engine.mp3` + brand text config
**Output:** `projects/<project>/output/logo-reveal.mp4`

### Track structure
```
Track 0: Tagline title clip    (appears at 7s, fades in/out, position: bottom)
Track 1: Runway video          (0–10s, fit: cover, fade out)
Track 2: Audio clip            (0–10s, effect: fadeOut)
```

### Shotstack gotchas
| Issue | Fix |
|---|---|
| Audio not playing | Use `asset.type: 'audio'` in a track — do NOT use `timeline.soundtrack` (unreliable) |
| Text overlapping video | `position` must be on the **clip**, not inside `asset` |
| Valid position values | `top`, `topRight`, `right`, `bottomRight`, `bottom`, `bottomLeft`, `left`, `topLeft`, `center` |
| Tagline looks plain | Shotstack title clips are styled text only — no particle effects. For animated text, use Runway. |
| Watermark on output | Must use `SHOTSTACK_ENV=v1` and production API key. `stage` env adds a watermark. |

---

## Workflow Decisions Log

### Why Runway instead of Shotstack for effects?
Shotstack title and HTML clips render plain styled text — no particles, no light rays,
no smoke. Runway Gen-4 is a video AI that interprets an image and generates motion.
It's the only service in this stack that can produce real cinematic visual effects.

### Why is the tagline added in Shotstack, not Runway?
Runway doesn't support precise text placement or timing. It treats text in an image as
part of the visual scene, not as a controlled overlay. Shotstack gives exact control
over when text appears, where it sits, and how it transitions.

### Why extract audio from existing footage?
The MOV files from the project shoot likely contain real performance car audio — engine
sounds, tire noise, ambient track atmosphere. This is more authentic than generated SFX
and costs $0. ElevenLabs is better suited for voiceovers or custom SFX that don't exist
in the footage.

---

## CLI Reference

```bash
# Standard run (use cached assets where available)
npx tsx scripts/logo-reveal.ts

# Regenerate everything from scratch
npx tsx scripts/logo-reveal.ts --force

# Skip audio (video only)
npx tsx scripts/logo-reveal.ts --skip-audio

# Force a new Runway generation only (keep cached audio/images)
npx tsx scripts/logo-reveal.ts --force-runway
```

---

## Future Improvements

- [ ] `--force-step <audio|image|runway|composite>` — regenerate a single step
- [ ] Named prompt presets (save/load proven Runway prompts by name)
- [ ] Brand config file (`brand.json`) per project instead of hardcoded constants
- [ ] Multi-format output (9:16 for Reels, 1:1 for Instagram) from one Runway generation
- [ ] Cost estimator — print credit cost before running, ask for confirmation
- [ ] Audio trim UI — choose which segment of the source footage to use
