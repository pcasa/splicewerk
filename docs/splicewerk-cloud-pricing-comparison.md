# Splicewerk: Cloud Services Pricing Comparison

*Last updated: March 2026*

---

## Active Subscriptions (Review Monthly)

> Update this table whenever you add, cancel, or change a plan. Review at the end of each month against actual output volume.

| Service | Plan | Monthly Cost | Status | Keep? |
|---------|------|-------------|--------|-------|
| **Runway** | Standard annual | $12 | ✅ Active | Pipeline video generation |
| **ElevenLabs** | Starter | $5 | ✅ Active | SFX + audio |
| **Inngest** | Free tier | $0 | ✅ Active | Workflow orchestration |
| **Shotstack** | Monthly | $39 | ✅ Active | Video assembly (replacing FFmpeg) |
| **Epidemic Sound** | — | — | ⬜ Not yet | Music + safelist |
| **OpenArt** | — | — | ⬜ Not yet | Manual creative exploration |
| **NVIDIA / Ollama** | Free | $0 | ✅ Active | LLM (cloud model) |
| **Total** | | **$56/mo** | | |

### Shotstack — Worth Keeping?
Review after first 10 videos. Key question: does cloud rendering save enough debugging time vs. $39/mo?
- Break-even vs. free FFmpeg: ~4 hours of debugging time saved per month
- If pipeline runs reliably end-to-end, keep it. If you hit render limits, check usage dashboard.

---

## Service Summary

| Service | Role in Splicewerk | Has API? | Free Tier? |
|---------|----------------|----------|------------|
| **Nemotron 3 Super** | Brain — prompt interpretation, EDL generation | Yes (Ollama OpenAI-compat) | Fully free |
| **Runway** | Video generation, editing, transitions, bg removal | Yes (official SDK, MCP server) | 125 one-time credits |
| **Kling AI** | Intro generation, photo-to-cinematic-clip, effects | Yes (official + 3rd party) | 66 credits/day |
| **ElevenLabs** | Sound effects (burnout, engine revs), music, TTS | Yes (official SDK) | 10K credits/mo |
| **Epidemic Sound** | Background music library, YouTube safelist protection | Yes (browse/download API) | No (paid only) |
| **Descript** | Transcript editing, audio cleanup, captions | Limited (no full API) | Free with watermark |

---

## 1. Runway

### Plans

| Plan | Monthly | Annual (per mo) | Credits/mo | Key Features |
|------|---------|-----------------|------------|--------------|
| **Free** | $0 | — | 125 (one-time) | Gen-4 Turbo img→vid, 720p, watermarked |
| **Standard** | $15 | $12 | 625 | All apps, Aleph, Gen-4.5, Gen-4, Act-Two, 1080p, no watermark |
| **Pro** | $35 | $28 | 2,250 | Everything in Standard + custom voices, 500GB storage |
| **Unlimited** | $95 | $76 | 2,250 + unlimited at relaxed rate | Explore mode, unlimited gens at slower speed |
| **Enterprise** | Custom | Custom | Custom | SSO, priority support, custom integrations |

### Credit Burn Rates
- **Gen-4 Turbo**: 5 credits/second
- **Gen-4**: 12 credits/second
- **Gen-4.5 text-to-video**: varies

### What This Means for Splicewerk
A typical 5-second generated clip via Gen-4 Turbo = 25 credits. On the Standard plan (625 credits), that's ~25 clips/month. On Pro (2,250 credits), ~90 clips/month.

**Credits do NOT roll over.** Unused credits expire at billing cycle end.

### API Pricing (Separate from Plans)
Runway has a separate developer API with its own pricing. You can use the API independently of a subscription plan. API pricing is per-second of video generated.

### Recommendation for Splicewerk
**Start with Standard ($12/mo annual).** For 2-3 generated clips per video, 625 credits covers roughly 8-12 videos/month. If you scale up or want faster generation, Pro at $28/mo annual is the sweet spot. The Unlimited plan's "relaxed rate" means slower generation — acceptable for batch overnight renders but annoying for interactive use.

**OR use API-only** if you want pure pay-per-use without a subscription. Better for unpredictable/low volume.

---

## 2. Kling AI

### Plans

| Plan | Monthly | Annual (per mo) | Credits/mo | Key Features |
|------|---------|-----------------|------------|--------------|
| **Free** | $0 | — | 66/day (no rollover) | 720p, watermarked, standard mode only |
| **Standard** | ~$7 | ~$5.50 | 660 | 1080p, no watermark, Professional mode, Kling O1 & 2.6 |
| **Pro** | ~$26 | ~$24 | 3,000 | Everything in Standard + higher volume |
| **Premier** | ~$65 | ~$61 | 8,000 | Everything in Pro + Kling Image O1 |
| **Ultra** | ~$180 | ~$119 | 26,000 | Maximum volume |

### Credit Burn Rates
- **Standard mode** (5s video): 10 credits
- **Professional mode** (5s video): 35 credits
- **Professional mode** (10s video): 70 credits
- **Kling 2.6 with native audio**: ~5x more credits than basic generation
- **Video extension** (per 5s): ~35 credits

### What This Means for Splicewerk
On the Standard plan ($7/mo, 660 credits):
- Professional mode 5s clips: ~18 videos/month
- Standard mode 5s clips: ~66 videos/month

On Pro ($26/mo, 3,000 credits):
- Professional mode 5s clips: ~85 videos/month

### Important Gotchas
- **Paid credits expire** if not used within validity period
- **Failed generations still consume credits** (no refunds)
- **Data sovereignty**: Kling is operated by Kuaishou (Chinese company) — your assets are processed on their servers. For car content this is probably fine, but worth knowing.
- **Native audio (Kling 2.6/3.0)** is expensive in credits — a 10s video with sound effects costs 5x a silent one

### API Access: The Catch
Kling's official direct API requires **prepaid resource packages starting at ~$4,200 for 30,000 units (90-day validity)**. This is enterprise pricing and not viable for indie creators.

**Workarounds for API access:**
- **Third-party resellers** (PiAPI, Atlas Cloud, fal.ai) offer Kling API at pay-per-use rates (~$0.08-0.17/sec) with no deposit. Atlas Cloud gives $1 free credit on signup.
- **OpenArt** (see below) gives you web UI access to Kling + many other models under one subscription — great for manual exploration, but no programmatic API.

### Recommendation for Splicewerk
**Do NOT subscribe to Kling directly for the automated pipeline.** The API barrier is too high.

Instead:
- **For the Inngest pipeline**: Use **Runway API** as the primary cloud video engine (proper SDK, MCP server, transparent pricing).
- **For manual creative work**: Use **OpenArt Advanced** ($14.50/mo) which gives you Kling 3.0, Veo 3, Runway, Wan 2.5, and 100+ other models in one UI. Generate clips manually, drop them in your assets folder, and the pipeline picks them up.
- **If you later need Kling in the pipeline**: Use **Atlas Cloud** or **PiAPI** as a third-party API reseller (~$0.13/sec, no deposit).

---

## 3. ElevenLabs

### Plans

| Plan | Monthly | Credits/mo | TTS Minutes (v3) | TTS Minutes (Flash) | Key Features |
|------|---------|------------|-------------------|---------------------|--------------|
| **Free** | $0 | 10,000 | ~10 | ~20 | Basic TTS, sound effects, music, no commercial license |
| **Starter** | $5 | 30,000 | ~30 | ~60 | Commercial license, instant voice cloning, dubbing |
| **Creator** | $22 | 100,000 | ~100 | ~200 | Professional voice cloning, 192kbps audio |
| **Pro** | $99 | 500,000 | ~500 | ~1,000 | 44.1kHz PCM output via API |
| **Scale** | $330 | 2,000,000 | ~2,000 | ~4,000 | 3 seats, team collaboration |

### Sound Effects Pricing (Your Primary Use Case)
- **Via website**: 4 SFX per generation, 200 credits (auto-duration) or 40 credits/second (custom duration)
- **Via API**: 1 SFX per generation, 100 credits (auto-duration) or 20 credits/second (custom duration)
- **Max duration**: 30 seconds per generation

### What This Means for Splicewerk
For generating sound effects like tire burnouts, engine revs, garage ambience:

**Via API at 20 credits/second:**
- 5-second burnout SFX = 100 credits
- On Starter ($5/mo, 30K credits): ~300 sound effects/month
- On Free (10K credits): ~100 sound effects/month

**The free tier is likely enough** for SFX generation. 10K credits = ~100 sound effects per month via API. You'd realistically need 3-5 SFX per video.

### Music Generation
ElevenLabs also has Eleven Music (text-to-music). Could potentially replace your background music library with AI-generated tracks. Available on all plans.

### Recommendation for Splicewerk
**Start with Free ($0).** 10K monthly credits gives you ~100 API SFX generations or ~20 minutes of TTS. For your use case (a few burnout sounds, engine revs, maybe an intro jingle per video), the free tier is plenty.

**Upgrade to Starter ($5/mo) only if** you want:
- Commercial license (needed if you monetize the YouTube channel)
- Voice cloning (could be interesting for consistent narrator voice)
- More credits for music generation

**You do NOT need Creator/Pro** unless you're generating voiceovers at scale.

**Important: Commercial license requires Starter ($5/mo) minimum.** If you're running YouTube ads or monetizing the channel, this matters.

---

## 4. Epidemic Sound (Background Music)

### Why Epidemic Sound Specifically

Epidemic Sound's killer feature for YouTube creators is **safelisting** — you connect your YouTube channel to your Epidemic Sound account, and their system proactively clears all music you use, preventing Content ID claims before they happen. Other libraries make you fight claims after the fact. Epidemic prevents them entirely.

Their catalog includes 50,000+ tracks and 200,000+ sound effects, searchable by mood, genre, tempo, instrument, and energy level — all metadata the LLM can use when selecting tracks in the EDL.

### Plans

| Plan | Monthly | Annual (per mo) | Key Features |
|------|---------|-----------------|--------------|
| **Creator** | $18 | $10 | Personal use, 1 channel safelist, unlimited downloads, music + SFX |
| **Pro** | $40 | $17 | Client work, multi-channel, commercial ads |
| **Enterprise** | Custom | Custom | Broadcast, film, TV |

### What This Means for Splicewerk
On the Creator plan ($10/mo annual), you get:
- Unlimited music downloads — no per-track cost
- Unlimited SFX downloads (200K+ library — engine sounds, impacts, ambience)
- Safelist protection for your YouTube channel
- Tracks can be trimmed, looped, cut — no restrictions on editing
- License covers YouTube, TikTok, Instagram, podcasts
- **Tracks downloaded while subscribed remain licensed even if you cancel** (for content published during subscription)

### How It Fits the Pipeline
The framework maintains a local music library (`assets/music/`) pre-populated with downloaded Epidemic Sound tracks tagged by mood/energy:
- `upbeat_garage.mp3` — for build montages
- `chill_cruise.mp3` — for driving footage
- `dramatic_reveal.mp3` — for before/after reveals
- `ambient_workshop.mp3` — for install sequences

The LLM selects from this tagged library based on the video prompt. Epidemic Sound's catalog is browsed manually to curate the library, not called via API per-render.

### ElevenLabs vs Epidemic Sound: Complementary, Not Competing

| Need | Best Tool | Why |
|------|-----------|-----|
| Background music tracks | Epidemic Sound | Pre-cleared, safelist, professional quality |
| Custom one-off music | ElevenLabs Eleven Music | AI-generated to match specific mood/tempo |
| Sound effects (burnout, revs) | ElevenLabs SFX API | Programmatic, per-video generation in pipeline |
| Ambient SFX (rain, garage) | Either | Epidemic has library; ElevenLabs can generate |

### Recommendation for Splicewerk
**Creator plan ($10/mo annual billing).** This is the no-brainer for any monetized YouTube channel. The safelist alone is worth it — one prevented Content ID claim saves hours of dispute headaches. You'd use Epidemic Sound as your curated music library and ElevenLabs for programmatic SFX generation in the pipeline.

---

## 5. Descript

### Plans

| Plan | Monthly | Key Features |
|------|---------|--------------|
| **Free** | $0 | 10 min transcription, basic editing, watermarked exports |
| **Hobbyist** | $8 | 10 hrs transcription, no watermark, filler word removal |
| **Creator** | $24 | Unlimited transcription, Studio Sound, AI voices |
| **Business** | $33 | Team features, custom brand kit |

### Recommendation for Splicewerk
**Skip the subscription for now.** Descript doesn't have a full programmatic API, so it can't be automated in the Inngest pipeline. It's a manual tool. For the MVP:
- Use **Whisper (free, local)** for auto-captioning
- Use **FFmpeg audio filters** for basic noise reduction
- Consider Descript later if you need heavy transcript-based editing for voiceover content

---

## 6. Shotstack (Video Assembly API)

### What It Is
Shotstack is a cloud video editing API — you send it a JSON edit spec and it renders the final MP4 in the cloud. No local FFmpeg, no encoding issues, no VideoToolbox crashes. Designed exactly for automated video production pipelines.

### Plans

| Plan | Monthly | Renders/mo | Max Resolution | Key Features |
|------|---------|-----------|----------------|--------------|
| **Free** | $0 | 10 | 720p | Watermarked |
| **Starter** | $39 | 400 | 1080p | No watermark, webhooks |
| **Scale** | $99 | 1,500 | 4K | Priority queue, custom fonts |
| **Enterprise** | Custom | Unlimited | 4K+ | SLA, dedicated queue |

### How It Fits the Pipeline
Replaces the FFmpeg concat/reformat/trim steps entirely:
- **Trim clips** → Shotstack timeline `clip` with `start`/`length`
- **Concat segments** → Shotstack timeline track ordering
- **Text overlays** → Shotstack `HTMLAsset` or `TitleAsset`
- **Reformat for platforms** → Shotstack output `size` (1920x1080, 1080x1920, etc.)
- **Audio mixing** → Shotstack `AudioAsset` with volume controls

### What You Need
1. API key from `dashboard.shotstack.io`
2. Add `SHOTSTACK_API_KEY` to `.env`
3. Shotstack can reference files by URL — Runway output videos need to be publicly accessible (upload to S3/Cloudinary first, or use Shotstack's own hosted ingestion)

### Recommendation for Splicewerk
**Starter ($39/mo) is the right tier.** 400 renders/month covers ~13 videos/day — far more than needed. The no-watermark 1080p output and webhooks (so Inngest can get notified when rendering completes) are the key features.

---

## 7. OpenArt (Multi-Model Creative Hub)

### What It Is
OpenArt is a unified web UI giving you access to 100+ AI models (Kling 3.0, Veo 3, Runway Gen-4, Wan 2.5, Nano Banana, and more) under one subscription with shared credits. One subscription replaces juggling multiple service accounts for manual creative exploration.

### Plans

| Plan | Monthly | Annual (per mo) | Credits/mo | ~Videos/mo | Parallel Gens |
|------|---------|-----------------|------------|------------|---------------|
| **Free** | $0 | — | 40 (one-time) | 0 | 4 |
| **Essential** | $14 | $7 | 4,000 | ~50 | 8 |
| **Advanced** | $29 | $14.50 | 12,000 | ~150 | 16 |
| **Infinite** | $56 | $28 | 24,000 | ~300 | 32 |
| **Wonder** | $240 | $120 | 106,000 | ~1,300 | 32 |

### What It Does NOT Do
OpenArt is a **web UI platform, not a programmatic API**. You cannot call it from Inngest steps or automate it in the pipeline. It's for manual experimentation and one-off generation only.

### Recommendation for Splicewerk
**Advanced ($14.50/mo annual) is the sweet spot.** ~150 videos/month across ANY model they support. Use it to:
- Experiment with Kling 3.0, Veo 3, Wan 2.5 side-by-side before picking one for your intros
- Generate one-off cinematic clips manually, drop them in your `assets/` folder
- Try new models as they launch without signing up for each service separately

This replaces the need for a direct Kling subscription entirely, plus gives you access to models you wouldn't otherwise have.

---

## 7. Cost Scenarios for Splicewerk

### Scenario A: Maximum Free (Zero Monthly Cost)

| Service | Plan | Monthly Cost |
|---------|------|-------------|
| Nemotron 3 Super | Cloud (free) | $0 |
| FFmpeg | Local | $0 |
| Inngest | Self-hosted / free tier | $0 |
| ElevenLabs | Free | $0 |
| Runway | Free (125 one-time credits) | $0 |
| OpenArt | Free (40 one-time credits) | $0 |
| Epidemic Sound | None (use YouTube Audio Library) | $0 |
| **Total** | | **$0/mo** |

**Trade-offs:** Watermarks on Runway output. No commercial license on ElevenLabs audio. No safelist protection on music. Good for prototyping and proving the concept only.

### Scenario B: Recommended Starting Stack (~2 videos/week)

| Service | Plan | Monthly Cost |
|---------|------|-------------|
| Nemotron 3 Super | Cloud (free) | $0 |
| FFmpeg | Local | $0 |
| Inngest | Free tier (5K runs/mo) | $0 |
| ElevenLabs | Starter (SFX + AI music) | $5 |
| Epidemic Sound | Creator annual (music + safelist) | $10 |
| Runway | Standard annual (pipeline API) | $12 |
| OpenArt | Advanced annual (manual exploration) | $14.50 |
| **Total** | | **$41.50/mo** |

**Gets you:** Commercial licenses, no watermarks, YouTube safelist on all music, ~25 Runway API clips for the pipeline + ~150 videos via OpenArt for manual creative work (Kling, Veo, etc.) + unlimited music downloads + 300 SFX generations per month. Covers 8-10 finished videos/month comfortably.

### Scenario C: Active Production (~4-5 videos/week)

| Service | Plan | Monthly Cost |
|---------|------|-------------|
| Nemotron 3 Super | Cloud (free) | $0 |
| FFmpeg | Local | $0 |
| Inngest | Free tier | $0 |
| ElevenLabs | Starter | $5 |
| Epidemic Sound | Creator annual | $10 |
| Runway | Pro annual (pipeline API) | $28 |
| OpenArt | Advanced annual | $14.50 |
| **Total** | | **$57.50/mo** |

**Gets you:** ~90 Runway API clips for the pipeline + ~150 OpenArt videos for manual exploration + unlimited music + 300 SFX per month. Covers 20+ finished videos/month.

---

## 8. The Two-Track Strategy

### Automated Pipeline (Inngest → API calls)
These services have proper APIs and get called programmatically:
- **Runway API** — video generation, transitions, image-to-video
- **ElevenLabs API** — sound effects, AI music
- **Ollama/Nemotron** — LLM brain
- **FFmpeg** — local video processing

### Manual Creative Exploration (Web UI)
These are used manually, with outputs dropped into the `assets/` folder:
- **OpenArt** — experiment with Kling, Veo, Wan, Runway across 100+ models
- **Epidemic Sound** — browse and curate your music library
- **Descript** — audio cleanup when needed (future)
- **Final Cut Pro** — manual polish via FCPXML (future)

This separation means you get the best of both worlds: automation where it matters, human creative judgment where it adds value.

---

## 9. Recommendation Summary

| Service | Role | Recommended Plan | Monthly Cost |
|---------|------|-----------------|-------------|
| **Nemotron 3 Super** | LLM brain | Cloud (free) | $0 |
| **FFmpeg** | Video processing backbone | Local | $0 |
| **Inngest** | Workflow orchestration | Free tier or self-hosted | $0 |
| **Runway** | Pipeline video generation (API) | Standard annual | $12 |
| **OpenArt** | Manual creative exploration (Web UI) | Advanced annual | $14.50 |
| **Epidemic Sound** | Background music + safelist | Creator annual | $10 |
| **ElevenLabs** | SFX + AI music (API) | Starter | $5 |
| **Descript** | Audio cleanup | Skip for now | $0 |
| **Total** | | | **$41.50/mo** |

This gets you a fully automated video pipeline with AI-generated transitions and SFX, access to every major AI video model for creative exploration, professionally licensed music with YouTube safelist protection, and commercial licenses across the board — for about the cost of a single ChatGPT Pro subscription.
