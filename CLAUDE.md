# Splicewerk — Claude Project Context

## What This Is

AI-driven video production pipeline for **Autobahn Syndicate** (German automotive
performance brand). Core POC: **Nemotron (NVIDIA NIM) generates creative prompts
that feed Runway Gen-4 for cinematic video generation** — AI-to-AI pipeline.

Eventually evolves into a full content creation platform for car event footage:
upload clips → trim → sequence → AI-assisted assembly → approve → publish to
YouTube / Shorts / Instagram / TikTok.

---

## Monorepo Structure

```
splicewerk/
├── apps/
│   └── web/                  # Next.js 14 dashboard (port 3001, App Router, Tailwind)
├── packages/
│   └── db/                   # PLANNED — shared Supabase client (@splicewerk/db)
├── src/
│   ├── server.ts             # Node.js HTTP server (port 3000) — all backend API routes
│   ├── cli/index.ts          # CLI entry point
│   ├── inngest/
│   │   ├── client.ts         # Inngest client + event types
│   │   └── functions/
│   │       ├── logo-reveal.ts    # Main pipeline function (7 steps)
│   │       └── produce-video.ts  # General video production function
│   ├── services/
│   │   ├── llm.ts            # Nemotron/NIM + Ollama fallback, generateCinematicPrompt()
│   │   ├── runway.ts         # Runway Gen-4 Turbo image-to-video
│   │   ├── shotstack.ts      # Shotstack cloud video assembly
│   │   ├── elevenlabs.ts     # ElevenLabs SFX/audio
│   │   ├── ffmpeg.ts         # Local ffmpeg wrapper
│   │   ├── thumbnail.ts      # Thumbnail generation
│   │   └── asset-catalog.ts  # Local asset catalog
│   └── ui/
│       └── dashboard.html    # Vanilla JS dashboard (legacy, being replaced by apps/web/)
├── scripts/                  # One-off and utility scripts (tsx)
├── projects/
│   └── cinematic-intro/
│       └── brand.json        # Brand config — single source of truth for Autobahn Syndicate
├── supabase/                 # PLANNED — migrations, config
└── docs/                     # Documentation including supabase-local-dev.md
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 24, TypeScript, tsx (dev) |
| Package manager | pnpm 10 (monorepo with pnpm-workspace.yaml) |
| Frontend | Next.js 14, App Router, Tailwind CSS, Montserrat font |
| Pipeline orchestration | Inngest (local dev server port 8288, Inngest Cloud in prod) |
| AI — prompt generation | NVIDIA NIM: `nvidia/llama-3.3-nemotron-super-49b-v1` (text), `nvidia/nemotron-nano-12b-v2-vl` (vision) |
| AI — video generation | Runway Gen-4 Turbo (`gen4_turbo`, 10s, 1280:720) |
| Video assembly | Shotstack Edit API (cloud, ~$0.10/render) |
| Image processing | sharp (SVG→PNG overlays, logo prep) |
| Video processing | ffmpeg (tagline burn, local) |
| Audio | ElevenLabs SFX |
| Database + Storage | Supabase Pro ($25/mo) — not yet initialized |
| Testing | Vitest |

---

## Running Locally

Three processes needed simultaneously:

```bash
# 1. Backend API server (port 3000)
pnpm dev

# 2. Inngest local dev server (port 8288)
pnpm inngest:dev

# 3. Next.js dashboard (port 3001)
pnpm --filter @splicewerk/web dev
```

Dashboard: http://localhost:3001
Inngest UI: http://localhost:8288

---

## Key API Routes (src/server.ts)

| Route | Method | Purpose |
|---|---|---|
| `/api/inngest` | ALL | Inngest function handler |
| `/api/trigger` | POST | Trigger logo-reveal pipeline |
| `/api/approve` | POST | Send approval event to Inngest |
| `/api/runs` | GET | Recent pipeline runs (Inngest GraphQL → Postgres eventually) |
| `/api/credits` | GET | Service status + ElevenLabs usage |
| `/api/nemotron` | POST | Chat with Nemotron (NIM) |
| `/api/pending-prompt` | GET | Last Nemotron-generated Runway prompt |

All routes proxied through `apps/web/src/app/api/*/route.ts` → `localhost:3000`.

---

## Pipeline: Logo Reveal (`src/inngest/functions/logo-reveal.ts`)

Event: `brand/logo-reveal-requested`

```
Step 1: load-brand-config       → reads projects/cinematic-intro/brand.json
Step 2: prepare-logo-image      → sharp: remove bg, composite on black 1920×1080 JPEG
Step 3: nemotron-generate-prompt → NIM vision model analyzes logo → generates Runway prompt
Step 4: wait-for-approval       → step.waitForEvent('brand/approved', timeout: 24h)
Step 5: runway-generate-video   → Runway Gen-4 Turbo, ~125 credits, up to 5min
Step 6: shotstack-upload        → upload video + raw MOV audio to Shotstack CDN
Step 7: shotstack-render        → Shotstack assembles video + audio
Step 8: burn-tagline            → sharp SVG→PNG overlay + ffmpeg fade-in/out
```

⚠️ **Pre-deploy fix required:** Step 5 uses a blocking 5-min poll loop inside
one `step.run()`. Must be refactored to `step.sleep()` between polls before
deploying to Vercel/Railway (serverless timeout issue).

---

## Brand Config (`projects/cinematic-intro/brand.json`)

Single source of truth. Pipeline reads this — never hardcode brand values.

```json
{
  "name": "Autobahn Syndicate",
  "tagline": "Performance Driving Experience",
  "colors": { "primary": "#E02828", "secondary": "#F46E2C", "text": "#F7F6F5" },
  "fonts": { "heading": "Montserrat", "weight": "600", "letterSpacing": "6px", "taglineOpacity": 0.85 },
  "assets": { "logo": "projects/test-intro/raw/GoalImage.png" }
}
```

---

## Gitflow Convention

```
main      — production, tagged releases (v1.0.0)
develop   — integration, always ahead of main
feat/*    — feature branches from develop, PR back to develop
hotfix/*  — from main, merge to main + develop
```

Branch naming: `feat/CC-P{phase}-{number}-{description}`

**Always merge main back into develop after a release.**

Current branch: `feat/CC-P5-01-supabase-client`

---

## Supabase Plan (Phase 5 — in progress)

Supabase Pro project already created. Not yet initialized.
See `docs/supabase-local-dev.md` for full CLI workflow.

**Planned tables:** `runs`, `brand_configs`, `assets`, `clips`, `tags`,
`clip_tags`, `run_clips`, `cost_ledger` + `run_costs` view, `prompt_logs`.

**Planned storage buckets:** `brand-assets` (public), `generated-outputs` (public),
`mobile-uploads` (private).

**Local dev:** `supabase start` / `supabase db reset` — Docker-based, free to
destroy and rebuild on feature branches. Apply to cloud dev on develop merge,
cloud prod on main release.

Shared client will live in `packages/db/` as `@splicewerk/db`, exporting
`supabase` (service role) and `supabaseAnon` (browser Realtime).

---

## Deployment Plan (future)

```
apps/web/  →  Vercel (Next.js)
src/       →  Railway (Node.js + ffmpeg)
           →  Supabase (DB + Storage + Realtime)
           →  Inngest Cloud (pipeline orchestration)
```

---

## Media Asset Policy

**Media files do not belong in git.** All video, audio, and image assets go to
Supabase Storage once Phase 5 is complete. Gitignored: `*.mp4`, `*.mov`, `*.MOV`,
`*.mp3`, `*.HEIC`, `projects/**/*.jpg`, `projects/**/*.png`, `assets/logos/`.

Only `brand.json` config files are committed from `projects/`.

---

## Future Roadmap (in memory files)

- **Asset Manager** — upload, trim (in/out points), notes, tags, reusable clip library
- **Publishing** — YouTube standard + Shorts (primary), Instagram Reels + TikTok (via cross-post)
- **Cost tracking** — `cost_ledger` table, per-run cost visibility, retry inflation detection
- **Mobile app** — React Native (Expo) in `apps/mobile/` for car events
- **Prompt observability** — `prompt_logs` table captures every NIM/Nemotron call
  (pipeline + UI chat) with `source`, `metadata`, latency, tokens. Dashboard viewer
  for comparing prompt strategies. Log in `callLLM()` + `/api/nemotron` handler.
  Helper: `packages/db/src/prompts.ts → logPrompt()`
- **Auth** — Supabase Auth, coming after Phase 5 storage/DB work

Full details in `~/.claude/projects/.../memory/` files.

---

## Environment Variables

```bash
# Core
PORT=3000
INNGEST_DEV=1

# AI Services
NVIDIA_API_KEY=          # NVIDIA NIM — Nemotron models
RUNWAY_API_KEY=          # Runway Gen-4 Turbo
SHOTSTACK_API_KEY=       # Shotstack Edit API
ELEVENLABS_API_KEY=      # ElevenLabs SFX

# Supabase (Phase 5)
SUPABASE_URL=
SUPABASE_SERVICE_KEY=    # Server-side only, never expose to browser
SUPABASE_ANON_KEY=       # Safe for browser (NEXT_PUBLIC_ prefix in Next.js)
SUPABASE_PROJECT_REF=    # For management API usage monitoring

# Inngest (production only)
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
```
