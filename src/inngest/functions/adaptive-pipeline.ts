import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inngest } from '../client.js'
import { getRegistry } from '../../pipeline/registry.js'
import { orchestrate } from '../../pipeline/orchestrator.js'
import type { AdaptivePipelineEvent, AssetState, CompletedStep, PlannedStep } from '../../pipeline/types.js'

const MAX_ITERATIONS = 15

export const adaptivePipeline = inngest.createFunction(
  {
    id: 'adaptive-pipeline',
    name: 'Adaptive AI Pipeline',
    triggers: [{ event: 'pipeline/run' as AdaptivePipelineEvent['name'] }],
  },
  async ({ event, step }: { event: AdaptivePipelineEvent; step: import('inngest').GetStepTools<typeof inngest> }) => {
    const { projectDir, assets: initialAssets, userIntent } = event.data

    // Load the registry once — validates all functions are discoverable
    await step.run('init-registry', async () => {
      const registry = await getRegistry()
      return { functionCount: registry.size, functions: [...registry.keys()] }
    })

    let assets: AssetState = { ...initialAssets }
    const completedSteps: CompletedStep[] = []

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      // ── Ask Maverick what to do next ──────────────────────────────────────
      // Wrapped in step.run → memoized on Inngest replay, Maverick NOT re-called
      const plan = await step.run(`plan-iter-${iteration}`, async () => {
        return orchestrate(assets, userIntent, completedSteps)
      })

      // Log orchestration trace for debugging
      if (plan.debugTrace) {
        const t = plan.debugTrace
        console.log(`[adaptive] iter=${iteration} orchestration: ${t.totalRounds} round(s), skills-loaded=[${t.skillsLoaded.join(', ')}]`)
        for (const r of t.rounds) {
          const extra = r.requestedSkills ? ` → requested: [${r.requestedSkills.join(', ')}]` : ''
          console.log(`[adaptive]   round ${r.round} (${r.type}) ${r.durationMs}ms prompt=${r.promptChars}chars${extra}`)
        }
      }
      console.log(`[adaptive] iter=${iteration} done=${plan.done} steps=${plan.nextSteps.length} reasoning: ${plan.reasoning}`)

      if (plan.done) {
        console.log('[adaptive] Pipeline complete.')
        break
      }

      // ── Guard: strip steps whose asset inputs aren't ready yet ────────────
      // Maverick occasionally schedules dependent steps in the same batch.
      // Filter them out so they get re-planned next iteration.
      const registry = await getRegistry()
      const readySteps = plan.nextSteps.filter((plannedStep: PlannedStep) => {
        const fn = registry.get(plannedStep.functionName)
        if (!fn) return true // unknown function — let it fail with a clear error
        for (const inputDef of fn.manifest.inputs) {
          const val = plannedStep.inputs[inputDef.name]
          if (inputDef.type === 'asset' && typeof val === 'string' && !(val in assets)) {
            console.warn(`[adaptive] Deferring ${plannedStep.functionName} — asset "${val}" not in state yet`)
            return false
          }
          if (inputDef.type === 'string[]' && Array.isArray(val)) {
            for (const v of val) {
              // Only treat as an asset reference if it looks like a camelCase/kebab key
              // (no spaces, no special chars) AND it actually appears in the known asset state.
              // Text content like "Autobahn Syndicate" has spaces and is never an asset key.
              const looksLikeAssetKey = typeof v === 'string' && /^[a-zA-Z0-9_-]+$/.test(v)
              if (looksLikeAssetKey && v in assets === false) {
                // Only defer if this key was produced by a function — i.e. it's a known
                // output name from any registered function (not just arbitrary text).
                const isKnownOutput = [...registry.values()].some(fn =>
                  fn.manifest.outputs.some(o => o.name === v)
                )
                if (isKnownOutput) {
                  console.warn(`[adaptive] Deferring ${plannedStep.functionName} — asset "${v}" not in state yet`)
                  return false
                }
              }
            }
          }
        }
        return true
      })

      if (readySteps.length === 0) {
        console.error('[adaptive] All planned steps were deferred — likely a bad plan. Aborting iteration.')
        break
      }

      if (readySteps.length < plan.nextSteps.length) {
        console.log(`[adaptive] Executing ${readySteps.length}/${plan.nextSteps.length} steps (${plan.nextSteps.length - readySteps.length} deferred)`)
      }

      // ── Execute this batch in parallel ────────────────────────────────────
      const batchResults = await Promise.all(
        readySteps.map((plannedStep: PlannedStep) =>
          step.run(`execute-${iteration}-${plannedStep.id}`, async () => {
            const reg = await getRegistry()
            const fn = reg.get(plannedStep.functionName)
            if (!fn) {
              throw new Error(
                `Unknown function: "${plannedStep.functionName}". ` +
                `Available: ${[...reg.keys()].join(', ')}`
              )
            }

            console.log(`[adaptive] Running ${plannedStep.functionName} (${plannedStep.id})`)
            const start = Date.now()
            const outputs = await fn.execute(plannedStep.inputs, assets, projectDir)
            const durationMs = Date.now() - start
            console.log(`[adaptive] ${plannedStep.functionName} done in ${durationMs}ms → ${JSON.stringify(outputs)}`)

            return {
              step: plannedStep,
              outputs,
              durationMs,
            }
          })
        )
      )

      // ── Merge outputs into shared asset state ─────────────────────────────
      for (const result of batchResults) {
        Object.assign(assets, result.outputs)
        completedSteps.push({
          id: result.step.id,
          functionName: result.step.functionName,
          inputs: result.step.inputs,
          outputs: result.outputs,
          durationMs: result.durationMs,
        })
      }
    }

    const result = {
      runId: event.id,
      userIntent,
      completedAt: new Date().toISOString(),
      assets,
      completedSteps,
      finalOutput: assets.final ?? null,
      debug: {
        totalStepsExecuted: completedSteps.length,
        finalAssets: Object.keys(assets),
      },
    }

    // Write run manifest to projectDir so the dashboard can discover it from disk
    try {
      await writeFile(
        join(projectDir, `pipeline-run-${event.id}.json`),
        JSON.stringify(result, null, 2),
        'utf-8'
      )
    } catch (err) {
      console.warn('[adaptive] Failed to write run manifest:', err)
    }

    return result
  }
)
