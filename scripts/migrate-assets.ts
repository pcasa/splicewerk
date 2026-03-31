/**
 * Migrate local project assets to Supabase Storage.
 *
 * Scans projects/STAR/raw/ for video, audio, and image files, uploads each
 * to the appropriate bucket, and prints the resulting CDN URLs.
 *
 * Usage:
 *   pnpm tsx scripts/migrate-assets.ts [--dry-run] [--project cinematic-intro]
 *
 * Prerequisites:
 *   SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env
 *   Buckets must exist: brand-assets (public), mobile-uploads (private)
 */

import 'dotenv/config'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { uploadAsset, assetExists } from '@splicewerk/db'

// ─── Config ───────────────────────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  '.mp4':  'video/mp4',
  '.mov':  'video/quicktime',
  '.MOV':  'video/quicktime',
  '.avi':  'video/x-msvideo',
  '.mkv':  'video/x-matroska',
  '.mp3':  'audio/mpeg',
  '.m4a':  'audio/mp4',
  '.wav':  'audio/wav',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.HEIC': 'image/heic',
  '.heic': 'image/heic',
}

// Video/audio → mobile-uploads (private); images/logos → brand-assets (public)
function resolveBucket(ext: string): string {
  if (['.mp4', '.mov', '.MOV', '.avi', '.mkv', '.mp3', '.m4a', '.wav', '.HEIC', '.heic'].includes(ext)) {
    return 'mobile-uploads'
  }
  return 'brand-assets'
}

// ─── Args ─────────────────────────────────────────────────────────────────────

const dryRun = process.argv.includes('--dry-run')
const projectFilter = (() => {
  const idx = process.argv.indexOf('--project')
  return idx !== -1 ? process.argv[idx + 1] : undefined
})()

// ─── Scan ─────────────────────────────────────────────────────────────────────

async function collectFiles(rootDir: string): Promise<string[]> {
  const results: string[] = []
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(rootDir, entry.name)
      if (entry.isDirectory()) {
        results.push(...await collectFiles(fullPath))
      } else {
        const ext = path.extname(entry.name)
        if (MIME_MAP[ext]) results.push(fullPath)
      }
    }
  } catch { /* directory doesn't exist — skip */ }
  return results
}

async function findProjectDirs(projectsRoot: string): Promise<string[]> {
  const dirs: string[] = []
  try {
    const entries = await fs.readdir(projectsRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (projectFilter && entry.name !== projectFilter) continue
      dirs.push(path.join(projectsRoot, entry.name))
    }
  } catch {
    console.error(`projects/ directory not found at: ${projectsRoot}`)
  }
  return dirs
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const projectsRoot = path.resolve('projects')
  const projectDirs = await findProjectDirs(projectsRoot)

  if (projectDirs.length === 0) {
    console.log('No project directories found.')
    return
  }

  let totalFiles = 0
  let uploaded = 0
  let skipped = 0
  let failed = 0

  for (const projectDir of projectDirs) {
    const rawDir = path.join(projectDir, 'raw')
    const files = await collectFiles(rawDir)

    if (files.length === 0) {
      console.log(`  [skip] ${projectDir}/raw/ — no media files found`)
      continue
    }

    console.log(`\n📂 ${path.basename(projectDir)} (${files.length} files)`)

    for (const filePath of files) {
      totalFiles++
      const ext = path.extname(filePath)
      const mimeType = MIME_MAP[ext]!
      const bucket = resolveBucket(ext)
      // Supabase storage path: preserve relative structure under projects/
      const storagePath = path.relative(projectsRoot, filePath)

      const size = (await fs.stat(filePath)).size
      const sizeKB = Math.round(size / 1024)

      if (dryRun) {
        console.log(`  [dry-run] ${storagePath} → ${bucket} (${sizeKB}KB)`)
        continue
      }

      // Skip if already uploaded
      if (await assetExists(bucket, storagePath)) {
        console.log(`  [exists]  ${storagePath}`)
        skipped++
        continue
      }

      process.stdout.write(`  [upload]  ${storagePath} (${sizeKB}KB) ... `)
      const buffer = await fs.readFile(filePath)
      const result = await uploadAsset(bucket, storagePath, buffer, mimeType)

      if (result.ok) {
        console.log(`✅ ${result.url}`)
        uploaded++
      } else {
        console.log(`❌ ${result.error}`)
        failed++
      }
    }
  }

  if (!dryRun) {
    console.log(`\n─── Summary ───`)
    console.log(`  Total:    ${totalFiles}`)
    console.log(`  Uploaded: ${uploaded}`)
    console.log(`  Skipped:  ${skipped} (already in Supabase)`)
    console.log(`  Failed:   ${failed}`)
  }
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
