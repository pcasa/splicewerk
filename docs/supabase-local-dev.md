# Supabase Local Development Guide

## Overview

Feature branches use a **local Supabase stack** (Docker) so migrations can be
written, tested, and reset freely without touching the shared cloud project.

```
Local Docker     ←  feature branches (supabase start / stop / reset)
supabase-dev     ←  cloud project, migrations applied on merge to develop
supabase-prod    ←  future second cloud project, migrations applied on release to main
```

## ⚠️ Critical: Local vs Remote Commands

`supabase db push` with **no flags** pushes to the **remote (cloud) database**.
Always be explicit about where you are pushing:

| Command | Target |
|---|---|
| `supabase db push --local` | Local Docker stack only |
| `supabase db push` | Remote cloud project (prompts for confirmation) |
| `supabase db reset` | Local Docker stack only (safe) |
| `supabase db reset --linked` | Remote cloud project (destructive — never on prod) |

**Rule: on a feature branch, always use `--local`. Never run bare `supabase db push` on a feature branch.**

---

## One-Time Setup

### 1. Install Supabase CLI

```bash
brew install supabase/tap/supabase
```

Verify:
```bash
supabase --version
```

### 2. Initialize Supabase in the repo (already done — do not repeat)

```bash
supabase init
```

This creates the `supabase/` directory with `config.toml`. Already committed to the repo.

### 3. Link to the cloud dev project (one-time per machine)

```bash
supabase login
supabase link --project-ref <SUPABASE_PROJECT_REF>
```

`SUPABASE_PROJECT_REF` is the string in your Supabase dashboard URL:
`https://supabase.com/dashboard/project/<REF>`

---

## Local Stack Credentials

The local CLI uses different labels than the cloud dashboard:

| Local CLI label | Supabase equivalent | `.env` variable |
|---|---|---|
| **Publishable** | anon key | `SUPABASE_ANON_KEY` |
| **Secret** | service role key | `SUPABASE_SERVICE_KEY` |

---

## Daily Feature Branch Workflow

### Start local stack

```bash
supabase start
```

Docker pulls the Supabase images on first run (may take a few minutes).
Subsequent starts are fast. Outputs local credentials:

```
API URL:      http://127.0.0.1:54321
DB URL:       postgresql://postgres:postgres@127.0.0.1:54322/postgres
Studio URL:   http://127.0.0.1:54323
Publishable:  sb_publishable_...    ← this is the anon key
Secret:       sb_secret_...         ← this is the service role key
```

Add local credentials to `.env` for development (do not commit):
```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_KEY=sb_secret_...
```

### Write a migration

```bash
supabase migration new <description>
# e.g. supabase migration new initial_schema
# Creates: supabase/migrations/20260322120000_initial_schema.sql
```

Edit the generated SQL file with your schema changes.

### Apply migrations to local DB

```bash
supabase db push --local
```

Reset the local DB and replay all migrations from scratch:
```bash
supabase db reset
```

Use `db reset` freely on feature branches — it wipes and rebuilds the local DB
in seconds. No data is lost on the cloud project.

### View local Studio (Supabase dashboard for local DB)

```
http://127.0.0.1:54323
```

Full table editor, SQL editor, storage browser — same UI as the cloud dashboard.

### Stop local stack

```bash
supabase stop
```

Data persists between stop/start. Use `supabase stop --no-backup` to stop and
wipe all local data.

---

## Migration Lifecycle

### On a feature branch

1. `supabase start` — start local stack
2. `supabase migration new <name>` — create migration file
3. Write SQL in the generated file
4. `supabase db push --local` — apply to local DB only ⚠️ always use `--local` here
5. Test against local stack via Studio at http://127.0.0.1:54323
6. If something is wrong: `supabase db reset` — wipe and replay from scratch
7. Commit the migration file with the feature branch

### On merge to develop

After PR is merged to `develop`, apply the migration to the cloud dev project:

```bash
supabase db push
# Will prompt: "Do you want to push these migrations to the remote database?"
# Type Y only when on develop and intentionally targeting the cloud project
```

### On release to main (production)

1. Link to the prod Supabase project temporarily:
   ```bash
   supabase link --project-ref <PROD_PROJECT_REF>
   ```
2. Push migrations:
   ```bash
   supabase db push
   # Confirm Y when prompted
   ```
3. Re-link to dev project:
   ```bash
   supabase link --project-ref <DEV_PROJECT_REF>
   ```

---

## Migration File Naming

Supabase auto-prefixes with a timestamp. Keep descriptions short and clear:

```
supabase/migrations/
  20260322120000_initial_schema.sql       ← runs, brand_configs
  20260322120001_assets_clips.sql         ← assets, clips, tags, clip_tags, run_clips
  20260322120002_cost_ledger.sql          ← cost_ledger, run_costs view
  20260322120003_prompt_logs.sql          ← prompt_logs
```

Never edit a migration that has already been applied to the cloud dev or prod
project. Write a new migration to amend it.

---

## Environment Variables Summary

| Variable | Local | Cloud Dev | Cloud Prod |
|---|---|---|---|
| `SUPABASE_URL` | `http://127.0.0.1:54321` | from dashboard | from dashboard |
| `SUPABASE_ANON_KEY` | Publishable key from `supabase start` | from dashboard | from dashboard |
| `SUPABASE_SERVICE_KEY` | Secret key from `supabase start` | from dashboard | from dashboard |
| `SUPABASE_PROJECT_REF` | n/a | from dashboard URL | from dashboard URL |

All values go in `.env` (gitignored). Never commit keys.

---

## Troubleshooting

**Docker not running:**
```bash
open -a Docker   # macOS — start Docker Desktop
```

**Port conflict (54321 already in use):**
Edit `supabase/config.toml` to change the port, or stop whatever is using 54321.

**Accidentally ran `supabase db push` on a feature branch and pushed to remote:**
Do not panic. Write a down migration to reverse the changes and push that to remote,
then continue on local only with `--local`.

**Migration out of sync with cloud:**
```bash
supabase db push --dry-run   # preview what would be applied to remote
supabase db push             # apply to remote (confirm when prompted)
```

**Reset cloud dev DB (nuclear option — destroys all data):**
```bash
supabase db reset --linked
```
Only ever use this on the dev project, never prod.
