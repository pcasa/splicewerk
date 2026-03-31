/**
 * Dry-run the adaptive pipeline orchestrator.
 *
 * Simulates the full iteration loop — calls Maverick, validates plans,
 * prints what would execute — without touching FFmpeg or any external service.
 *
 * Usage:
 *   pnpm tsx scripts/test-pipeline.ts \
 *     --intent "Stabilize footage, add fade, concat with brand intro" \
 *     --assets '{"rawFootage":"/path/to/clip.MOV","brandIntro":"projects/cinematic-intro/logo-reveal.mp4"}'
 *
 *   # Use defaults (test-intro project):
 *   pnpm tsx scripts/test-pipeline.ts
 */

import 'dotenv/config'
import { orchestrate } from '../src/pipeline/orchestrator.js'
import { getRegistry } from '../src/pipeline/registry.js'
import type { AssetState, CompletedStep, PlannedStep } from '../src/pipeline/types.js'

const MAX_ITERATIONS = 15

// ─── Parse args ───────────────────────────────────────────────────────────────

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag)
  return idx !== -1 ? process.argv[idx + 1] : undefined
}

const userIntent = getArg('--intent') ??
  'Stabilize the raw footage, add a fade in and fade out, then combine it with the brand intro. No music or audio generation needed.'

const assetsArg = getArg('--assets')
let assets: AssetState = assetsArg
  ? JSON.parse(assetsArg) as AssetState
  : {
      rawFootage: '/Users/petercasanova/Projects/splicewerk/projects/test-intro/raw/IMG_0295.MOV',
      brandIntro: 'projects/cinematic-intro/logo-reveal.mp4',
      brandConfig: '/Users/petercasanova/Projects/splicewerk/projects/test-intro/brand.json',
    }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function checkReady(step: PlannedStep, currentAssets: AssetState, registry: Awaited<ReturnType<typeof getRegistry>>) {
  const fn = registry.get(step.functionName)
  if (!fn) return { ready: false, reason: `unknown function "${step.functionName}"` }
  for (const inputDef of fn.manifest.inputs) {
    const val = step.inputs[inputDef.name]
    if (inputDef.type === 'asset' && typeof val === 'string' && !(val in currentAssets)) {
      return { ready: false, reason: `asset "${val}" not in state` }
    }
    if (inputDef.type === 'string[]' && Array.isArray(val)) {
      for (const v of val) {
        // Only treat as asset reference if it's a simple identifier (no spaces/special chars)
        // AND it's a known output name from a registered function.
        const looksLikeAssetKey = typeof v === 'string' && /^[a-zA-Z0-9_-]+$/.test(v)
        if (looksLikeAssetKey && !(v in currentAssets)) {
          const isKnownOutput = [...registry.values()].some(fn =>
            fn.manifest.outputs.some(o => o.name === v)
          )
          if (isKnownOutput) {
            return { ready: false, reason: `asset "${v}" not in state` }
          }
        }
      }
    }
  }
  return { ready: true, reason: '' }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════')
console.log('  PIPELINE DRY-RUN')
console.log('═══════════════════════════════════════════════════════')
console.log(`Intent: ${userIntent}`)
console.log(`Initial assets: ${Object.keys(assets).join(', ')}`)
console.log('───────────────────────────────────────────────────────\n')

async function main() {
  const registry = await getRegistry()
  console.log(`Registry: ${registry.size} functions — [${[...registry.keys()].join(', ')}]\n`)

  const completedSteps: CompletedStep[] = []
  let iteration = 0

  for (iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    console.log(`\n┌─ ITERATION ${iteration} ─────────────────────────────────────`)
    console.log(`│  Assets: [${Object.keys(assets).join(', ')}]`)

    const plan = await orchestrate(assets, userIntent, completedSteps)

    if (plan.debugTrace) {
      const t = plan.debugTrace
      console.log(`│  Orchestration: ${t.totalRounds} round(s), skills=[${t.skillsLoaded.join(', ') || 'none'}]`)
      for (const r of t.rounds) {
        const skills = r.requestedSkills ? ` → [${r.requestedSkills.join(', ')}]` : ''
        console.log(`│    round ${r.round} (${r.type}) ${r.durationMs}ms${skills}`)
      }
    }

    console.log(`│  Reasoning: ${plan.reasoning}`)

    if (plan.done) {
      console.log('│  ✅ DONE')
      console.log('└──────────────────────────────────────────────────────\n')
      break
    }

    console.log(`│  Planned steps: ${plan.nextSteps.length}`)

    let deferred = 0
    for (const s of plan.nextSteps) {
      const { ready, reason } = checkReady(s, assets, registry)
      const tag = ready ? '  ▶ EXECUTE' : '  ⏸ DEFERRED'
      const detail = ready ? '' : ` (${reason})`
      console.log(`│  ${tag}  ${s.functionName} (${s.id})${detail}`)
      console.log(`│          inputs: ${JSON.stringify(s.inputs)}`)

      if (ready) {
        const fn = registry.get(s.functionName)!
        const fakeOutputs: Record<string, string> = {}
        for (const out of fn.manifest.outputs) {
          fakeOutputs[out.name] = `[simulated:${out.name}]`
        }
        Object.assign(assets, fakeOutputs)
        completedSteps.push({
          id: s.id,
          functionName: s.functionName,
          inputs: s.inputs,
          outputs: fakeOutputs,
          durationMs: 0,
        })
        console.log(`│          outputs: ${JSON.stringify(fakeOutputs)}`)
      } else {
        deferred++
      }
    }

    if (deferred === plan.nextSteps.length) {
      console.log('│  ⚠️  ALL steps deferred — bad plan, stopping.')
      console.log('└──────────────────────────────────────────────────────\n')
      break
    }

    console.log('└──────────────────────────────────────────────────────')
  }

  console.log('\n═══════════════════════════════════════════════════════')
  console.log(`  SUMMARY: ${iteration} iteration(s), ${completedSteps.length} step(s) simulated`)
  console.log(`  Final assets: [${Object.keys(assets).join(', ')}]`)
  console.log('═══════════════════════════════════════════════════════\n')
}

main().catch(err => { console.error(err); process.exit(1) })
