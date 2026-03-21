# Splicewerk: Getting Started Checklist

## Part 1: Account Signups

Sign up for these in order — some later steps reference credentials from earlier ones.

### Tier 0: Prerequisite Accounts (Free, needed before anything else)

| # | Service | URL | Cost | Why You Need It |
|---|---------|-----|------|----------------|
| 1 | **GitHub** | https://github.com | Free | Version control for the project repo. Runway's MCP server is hosted on GitHub. You likely already have this. |
| 2 | **NVIDIA Developer** | https://developer.nvidia.com | Free | Required for Nemotron cloud inference. Sign up → get a free API key from https://build.nvidia.com. The Ollama `:cloud` variant routes through NVIDIA's servers. |
| 3 | **Ollama** | https://ollama.com | Free | Download the Mac app. After install, run `ollama signin` to authenticate — required for cloud model routing (Nemotron Super `:cloud`). |

### Tier 1: Core Pipeline Services (Required for Splicewerk to function)

| # | Service | URL | Plan | Monthly Cost | What You Need |
|---|---------|-----|------|-------------|---------------|
| 4 | **Runway** (Creator account) | https://runwayml.com | Standard (annual) | $12 | Email signup for the main platform |
| 5 | **Runway** (Developer portal) | https://dev.runwayml.com | Included | — | Separate from the creator account. Sign up here for API keys. You need both accounts. |
| 6 | **ElevenLabs** | https://elevenlabs.io | Starter | $5 | Email signup → API key from Settings → API Keys |
| 7 | **Inngest** | https://www.inngest.com | Free tier (cloud) or self-hosted | $0 | Email/GitHub signup → get signing key + event key for local dev |

### Tier 2: Creative Exploration & Music (Recommended)

| # | Service | URL | Plan | Monthly Cost | What You Need |
|---|---------|-----|------|-------------|---------------|
| 8 | **OpenArt** | https://openart.ai | Advanced (annual) | $14.50 | Email signup — gives you Kling 3.0, Veo 3, Runway, Wan 2.5 all in one UI for manual creative work |
| 9 | **Epidemic Sound** | https://www.epidemicsound.com | Creator (annual) | ~$10 | Email signup → **safelist your YouTube channel** in account settings to prevent Content ID claims |
| — | *OR* **Uppbeat** | https://uppbeat.io | Free or Essentials ($5.59/mo) | $0-5.59 | Budget alternative — email signup → safelist channel |

### Tier 3: Optional / Future Phases

| # | Service | URL | Plan | Monthly Cost | What You Need |
|---|---------|-----|------|-------------|---------------|
| 10 | **Descript** | https://www.descript.com | Free (for now) | $0 | Manual audio cleanup — sign up when ready |
| 11 | **Final Cut Pro** | Mac App Store | One-time purchase | $299.99 (one-time) | For manual polish via FCPXML export — buy when ready |
| 12 | **YouTube Studio** (you already have this) | https://studio.youtube.com | Free | $0 | Access the built-in YouTube Audio Library for free backup music. Future: YouTube Data API for automated uploads. |

### Monthly Cost Summary

| Tier | Services | Monthly |
|------|----------|---------|
| **Minimum viable** | Ollama + Runway Standard + ElevenLabs Starter + Inngest free | **$17/mo** |
| **Recommended** | Above + OpenArt Advanced + Epidemic Sound | **$41.50/mo** |
| **Full stack** | Above + Descript free + Final Cut Pro | **$41.50/mo** + $299.99 one-time |

---

## Part 2: API Keys & Credentials

After signing up, collect these and store them in a `.env` file (never commit this):

```bash
# .env (add to .gitignore immediately)

# NVIDIA Developer - get from https://build.nvidia.com (click "Get API Key")
# Required for Nemotron cloud inference via Ollama
NVIDIA_API_KEY=nvapi-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Runway Developer - get from https://dev.runwayml.com (separate from creator account)
RUNWAY_API_KEY=rky_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ElevenLabs - get from https://elevenlabs.io/app/settings/api-keys
ELEVENLABS_API_KEY=sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Inngest - get from dashboard after creating app, or use dev server locally
INNGEST_SIGNING_KEY=signkey-xxxxxxxxxxxxxxxxxxxxx
INNGEST_EVENT_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Ollama - no API key needed, but you must sign in for cloud models
# Run: ollama signin
# This authenticates your local Ollama install with NVIDIA's cloud
OLLAMA_HOST=http://localhost:11434
```

### Ollama Sign-In (Required for Cloud Models)

After installing Ollama, you must authenticate before using `:cloud` models:

```bash
# Sign into Ollama (links to your NVIDIA account)
ollama signin

# This opens a browser for authentication
# Once complete, cloud models like nemotron-3-super:cloud will work
```

---

## Part 3: Local Tool Installation

### Prerequisites (install first)

```bash
# 1. Homebrew (if not already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. ASDF (if not already installed)
brew install asdf

# Ensure ASDF is in your shell config (~/.zshrc)
# You should already have this, but verify:
echo '. $(brew --prefix asdf)/libexec/asdf.sh' >> ~/.zshrc
source ~/.zshrc
```

### Runtime Versions via ASDF

```bash
# 3. Install ASDF plugins
asdf plugin add python
asdf plugin add nodejs

# 4. Install specific versions
asdf install python 3.12.8
asdf install nodejs 24.0.0

# 5. Set as project defaults (run from project root later)
# These will go in .tool-versions in the project
asdf local python 3.12.8
asdf local nodejs 24.0.0

# Verify
python --version   # Python 3.12.8
node --version     # v24.0.0
```

### Python Tooling

```bash
# 6. Install UV (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Verify
uv --version

# 7. Ruff comes as a project dependency via UV, but you can also install globally
uv tool install ruff

# Verify
ruff --version
```

### Node.js Tooling

```bash
# 8. Install pnpm
corepack enable
corepack prepare pnpm@latest --activate

# OR via npm if corepack isn't available
npm install -g pnpm

# Verify
pnpm --version
```

### Media Processing Tools

```bash
# 9. FFmpeg (with VideoToolbox hardware acceleration on Apple Silicon)
brew install ffmpeg

# Verify — should show "videotoolbox" in the hwaccels list
ffmpeg -hwaccels 2>/dev/null | grep videotoolbox

# 10. ImageMagick (backup for thumbnail generation)
brew install imagemagick

# 11. Sharp dependencies (Node.js image processing — installs via pnpm later)
# No separate install needed, pnpm handles it
```

### AI / LLM Tools

```bash
# 12. Ollama (local LLM runtime)
brew install ollama

# Start Ollama service
ollama serve &

# 13. Sign into Ollama (required for cloud models)
ollama signin
# This opens a browser — authenticate with your NVIDIA account
# Without this, nemotron-3-super:cloud will fail

# 14. Pull Nemotron 3 Super (cloud mode — no large download)
ollama pull nemotron-3-super:cloud

# Verify it's available
ollama list | grep nemotron

# 15. (Optional) Pull Nemotron 3 Nano for local fallback
# This is ~5GB, runs on base Apple Silicon
ollama pull nemotron-3-nano
```

### Whisper (Local Captioning — Phase 4)

```bash
# 16. whisper.cpp for local speech-to-text (install when ready for captions)
brew install whisper-cpp

# Download a model (base.en is small and fast, ~150MB)
# whisper-cpp ships with a download script
whisper-cpp-download-model base.en
```

### Docker (Optional — for self-hosted Inngest)

```bash
# 17. Docker Desktop for Mac (if self-hosting Inngest instead of cloud)
brew install --cask docker

# After Docker is running, start Inngest dev server:
# docker run -p 8288:8288 inngest/inngest:latest inngest dev
```

---

## Part 4: Project Scaffolding

Once all tools are installed, scaffold the Splicewerk project:

```bash
# Create project directory
mkdir splicewerk && cd splicewerk

# Set ASDF versions for this project
asdf local python 3.12.8
asdf local nodejs 24.0.0

# This creates .tool-versions:
cat .tool-versions
# python 3.12.8
# nodejs 24.0.0

# Initialize git
git init
cat > .gitignore << 'EOF'
node_modules/
.env
dist/
projects/*/rendered/
projects/*/prepared/
projects/*/output/
*.mp4
*.mov
*.avi
*.mkv
__pycache__/
.ruff_cache/
.venv/
EOF

# ─── Node.js setup ───
pnpm init

# Core dependencies
pnpm add typescript inngest @runwayml/sdk sharp fluent-ffmpeg yaml dotenv

# Dev dependencies
pnpm add -D @types/node @types/fluent-ffmpeg tsx

# TypeScript config
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
EOF

# ─── Python setup (for utility scripts, whisper, ffprobe wrappers) ───
uv init --python 3.12

# Add Python dependencies
uv add httpx pyyaml python-dotenv

# Dev dependencies
uv add --dev ruff pytest

# Ruff config
cat > ruff.toml << 'EOF'
target-version = "py312"
line-length = 100

[lint]
select = ["E", "F", "I", "N", "W", "UP", "B", "SIM"]

[format]
quote-style = "double"
EOF

# ─── Create directory structure ───
mkdir -p src/{cli,inngest/functions,services,edl,config,utils}
mkdir -p assets/{intros,outros,music,fonts,logos}
mkdir -p projects
mkdir -p scripts

# ─── Create .env template ───
cat > .env.example << 'EOF'
# Copy to .env and fill in your keys
NVIDIA_API_KEY=
RUNWAY_API_KEY=
ELEVENLABS_API_KEY=
INNGEST_SIGNING_KEY=
INNGEST_EVENT_KEY=
OLLAMA_HOST=http://localhost:11434

# Note: You must also run `ollama signin` to authenticate
# cloud models. The NVIDIA_API_KEY is for direct NVIDIA API
# calls if needed; Ollama signin handles cloud model auth.
EOF

echo "✅ Splicewerk project scaffolded. Run 'pnpm dev' to start."
```

### Add package.json Scripts

Add these to your `package.json`:

```json
{
  "scripts": {
    "dev": "tsx watch src/cli/index.ts",
    "build": "tsc",
    "inngest:dev": "npx inngest-cli@latest dev",
    "produce": "tsx src/cli/index.ts",
    "lint": "ruff check scripts/ && tsc --noEmit",
    "format": "ruff format scripts/"
  }
}
```

---

## Part 5: Verification Checklist

Run through this after setup to make sure everything works:

```bash
# ✅ ASDF versions
python --version          # 3.12.8
node --version            # v24.0.0

# ✅ Package managers
uv --version              # should return version
pnpm --version            # should return version

# ✅ Python tooling
ruff --version            # should return version

# ✅ Media tools
ffmpeg -version           # should show version + VideoToolbox
magick --version          # ImageMagick

# ✅ Ollama installed and signed in
ollama list               # should show nemotron-3-super:cloud
ollama signin --check     # should confirm authenticated (if supported)

# ✅ Test Nemotron cloud is responding
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nemotron-3-super:cloud",
    "messages": [{"role": "user", "content": "Say hello in JSON format"}],
    "max_tokens": 50
  }'
# If this fails with auth error, run: ollama signin

# ✅ NVIDIA API key works (optional direct test)
curl -s -w "\n%{http_code}" \
  https://integrate.api.nvidia.com/v1/models \
  -H "Authorization: Bearer $NVIDIA_API_KEY" | tail -1
# Should return 200

# ✅ Runway API key works
curl -s -w "\n%{http_code}" \
  https://api.dev.runwayml.com/v1/tasks \
  -H "Authorization: Bearer $RUNWAY_API_KEY" | tail -1
# Should return 200 (or 404 for no tasks, not 401)

# ✅ ElevenLabs API key works
curl -s -w "\n%{http_code}" \
  https://api.elevenlabs.io/v1/user \
  -H "xi-api-key: $ELEVENLABS_API_KEY" | tail -1
# Should return 200

# ✅ Node dependencies
cd splicewerk && pnpm install  # should complete without errors

# ✅ TypeScript compiles
pnpm build                  # should output to dist/

# ✅ Inngest dev server
pnpm inngest:dev            # should open dashboard at http://localhost:8288
```

---

## Quick Reference: What's What

| Tool | Purpose | Free? | Local/Cloud | Account Required? |
|------|---------|-------|-------------|-------------------|
| **GitHub** | Version control, Runway MCP server | Yes | Cloud | Yes (you have this) |
| **NVIDIA Developer** | API key for Nemotron cloud inference | Yes | Cloud | Yes — https://developer.nvidia.com |
| **ASDF** | Runtime version manager | Yes | Local | No |
| **Python 3.12 + UV + Ruff** | Utility scripts, linting, formatting | Yes | Local | No |
| **Node 24 + pnpm** | Main runtime (Inngest, Runway SDK, CLI) | Yes | Local | No |
| **FFmpeg** | Video processing backbone | Yes | Local | No |
| **Sharp** | Thumbnail generation (Node.js) | Yes | Local | No |
| **Ollama** | LLM runtime (routes to Nemotron cloud) | Yes | Local → Cloud | Yes — `ollama signin` (links to NVIDIA) |
| **Nemotron 3 Super :cloud** | Brain — EDL generation, creative decisions | Yes | Cloud (via Ollama) | Via Ollama signin |
| **Whisper.cpp** | Auto-captioning / speech-to-text | Yes | Local | No |
| **Inngest** | Workflow orchestration | Free tier | Cloud or self-hosted | Yes — https://www.inngest.com |
| **Runway API** | Automated video generation in pipeline | $12/mo | Cloud API | Yes — https://dev.runwayml.com (developer portal) |
| **ElevenLabs** | SFX + music generation | $5/mo | Cloud API | Yes — https://elevenlabs.io |
| **OpenArt** | Manual creative exploration (Kling, Veo, etc.) | $14.50/mo | Cloud web UI | Yes — https://openart.ai |
| **Epidemic Sound** | Licensed background music | ~$10/mo | Cloud web UI | Yes — https://www.epidemicsound.com |
