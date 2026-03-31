import 'dotenv/config'
import type {
  AssetState,
  CompletedStep,
  DiscoveryResponse,
  OrchestratorDebugTrace,
  OrchestratorPlan,
  OrchestratorRound,
} from './types.js'
import { buildFunctionCatalog } from './registry.js'
import {
  ALL_SKILL_NAMES,
  CAPABILITY_INDEX,
  formatSkillDocs,
  loadSkillDocs,
} from './skills.js'

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY ?? ''
const NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1'
const MAVERICK_MODEL = 'meta/llama-4-maverick-17b-128e-instruct'

/** Max orchestration rounds before forcing a plan (1 discovery + up to 2 plan attempts) */
const MAX_ROUNDS = 3

// ─── Prompts ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an adaptive video pipeline orchestrator for Autobahn Syndicate, a performance automotive content brand.

Your job: given the user's intent and available assets, plan a pipeline of steps to produce the desired video output.

You have two modes of response:

MODE 1 — REQUEST MORE INFO (use when you need service capability details to plan effectively):
Return exactly:
{
  "phase": "discovery",
  "requestedSkills": ["skill-name", ...],
  "reasoning": "one sentence explaining what you need to know"
}
Valid skill names: fal-ai, runway, elevenlabs, epidemic-sound, motion-graphics

MODE 2 — RETURN PLAN (when you have enough information):
Return exactly:
{
  "done": boolean,
  "reasoning": "brief explanation",
  "nextSteps": [
    { "id": "unique-id", "functionName": "exactName", "inputs": { "key": "value" } }
  ]
}

Rules:
- Return valid JSON only. No markdown, no prose outside the JSON.
- nextSteps is ONE PARALLEL BATCH. Every step must be runnable RIGHT NOW using ONLY assets already present in Current Asset State.
- NEVER put two steps in the same nextSteps if one depends on the other's output. Return only the first step, get called again once its output is in assets, then return the next step.
- Use asset key names from Current Asset State as input values for asset-typed inputs (e.g. "rawFootage", not a file path).
- Set done:true when the pipeline is complete. nextSteps can be empty then.

EXAMPLE — if you want to fade then concat:
WRONG (concat needs "faded" which addFade hasn't produced yet):
  nextSteps: [ {addFade inputs:{videoPath:"stabilized"}}, {concat inputs:{clips:["faded","brandIntro"]}} ]
CORRECT — first response:
  nextSteps: [ {addFade inputs:{videoPath:"stabilized"}} ]
CORRECT — second response (after "faded" appears in Current Asset State):
  nextSteps: [ {concat inputs:{clips:["faded","brandIntro"]}} ]`

function buildUserMessage(opts: {
  catalog: string
  assets: AssetState
  completedSteps: CompletedStep[]
  userIntent: string
  loadedSkillDocs: Record<string, string>
  forcePlan: boolean
}): string {
  const { catalog, assets, completedSteps, userIntent, loadedSkillDocs, forcePlan } = opts

  const assetSummary = Object.entries(assets)
    .map(([name, path]) => `  ${name}: ${path}`)
    .join('\n') || '  (none)'

  const completedSummary = completedSteps.length === 0
    ? '  None yet.'
    : completedSteps
        .map(s => `  - ${s.functionName} (${s.id}) → ${JSON.stringify(s.outputs)}`)
        .join('\n')

  const skillDocsSection = Object.keys(loadedSkillDocs).length > 0
    ? `\n## Loaded Service Documentation\n\n${formatSkillDocs(loadedSkillDocs)}`
    : ''

  const forcePlanNote = forcePlan
    ? '\n⚠️ IMPORTANT: You have reached the maximum discovery rounds. You MUST return a plan now — do not request more skills.\n'
    : ''

  return `## Available Pipeline Functions (atomic operations you can schedule)

${catalog}

## Service Capability Index (request full docs on any service you need)

${CAPABILITY_INDEX}
${skillDocsSection}

## Current Asset State
${assetSummary}

## Completed Steps
${completedSummary}

## User Intent
${userIntent}
${forcePlanNote}
## Your Task
Analyze what needs to happen and respond in one of the two JSON modes described in your instructions.`
}

// ─── Low-level API call ───────────────────────────────────────────────────────

async function callMaverick(userMessage: string): Promise<string> {
  const response = await fetch(`${NIM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${NVIDIA_API_KEY}`,
    },
    body: JSON.stringify({
      model: MAVERICK_MODEL,
      temperature: 0.2,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`Maverick API failed: HTTP ${response.status} ${response.statusText}`)
  }

  const data = await response.json() as { choices: { message: { content: string } }[] }
  const raw = (data.choices?.[0]?.message?.content ?? '').trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  if (!raw) throw new Error('Maverick returned empty response')
  return raw
}

// ─── Response parser ──────────────────────────────────────────────────────────

type MaverickResponse =
  | { type: 'discovery'; data: DiscoveryResponse }
  | { type: 'plan'; data: OrchestratorPlan }

function parseResponse(raw: string): MaverickResponse {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Maverick returned invalid JSON: ${raw.slice(0, 300)}`)
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Maverick returned non-object: ${raw.slice(0, 300)}`)
  }

  const obj = parsed as Record<string, unknown>

  // Discovery response
  if (obj.phase === 'discovery') {
    if (!Array.isArray(obj.requestedSkills)) {
      throw new Error('Discovery response missing requestedSkills array')
    }
    const validSkills = (obj.requestedSkills as unknown[])
      .filter((s): s is string => typeof s === 'string' && ALL_SKILL_NAMES.includes(s))
    if (validSkills.length === 0) {
      throw new Error(`Discovery response contained no valid skill names. Got: ${JSON.stringify(obj.requestedSkills)}`)
    }
    return {
      type: 'discovery',
      data: {
        phase: 'discovery',
        requestedSkills: validSkills,
        reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '',
      },
    }
  }

  // Plan response
  if (typeof obj.done !== 'boolean') {
    throw new Error(`Maverick response missing required "done" field: ${raw.slice(0, 300)}`)
  }
  if (obj.done) {
    return { type: 'plan', data: { done: true, reasoning: String(obj.reasoning ?? 'Complete.'), nextSteps: [] } }
  }
  if (!Array.isArray(obj.nextSteps) || obj.nextSteps.length === 0) {
    throw new Error('Maverick returned done:false but no nextSteps')
  }
  return { type: 'plan', data: parsed as OrchestratorPlan }
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

/**
 * Multi-round skill-aware orchestrator.
 *
 * Round 0: Sends assets + intent + lightweight capability index + function catalog.
 *          Maverick can request full docs for specific services or return a plan directly.
 * Round 1: If skills requested, loads those docs and re-asks.
 *          Maverick can request more skills or return a plan.
 * Round 2: Loads ALL remaining requested skills and forces a plan — no more discovery.
 *
 * All rounds are called inside step.run() by the caller — Inngest memoizes the
 * entire orchestrate() result, so Maverick is never re-called on step retry/replay.
 */
export async function orchestrate(
  assets: AssetState,
  userIntent: string,
  completedSteps: CompletedStep[]
): Promise<OrchestratorPlan> {
  const catalog = await buildFunctionCatalog()
  const loadedSkillDocs: Record<string, string> = {}
  const rounds: OrchestratorRound[] = []
  const allRequestedSkills = new Set<string>()

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const forcePlan = round === MAX_ROUNDS - 1
    const userMessage = buildUserMessage({
      catalog,
      assets,
      completedSteps,
      userIntent,
      loadedSkillDocs,
      forcePlan,
    })

    console.log(`[orchestrator] round=${round} type=${forcePlan ? 'forced-planning' : 'open'} skills-loaded=${Object.keys(loadedSkillDocs).join(',') || 'none'} prompt-chars=${userMessage.length}`)

    const roundStart = Date.now()
    const raw = await callMaverick(userMessage)
    const durationMs = Date.now() - roundStart

    console.log(`[orchestrator] round=${round} response (${durationMs}ms): ${raw.slice(0, 300)}`)

    let parsed: MaverickResponse
    try {
      parsed = parseResponse(raw)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[orchestrator] round=${round} parse error: ${msg}`)
      // On parse error in final round, throw. Otherwise try next round with force.
      if (forcePlan) throw new Error(`Maverick parse error on forced round: ${msg}`)
      // Force next round
      rounds.push({ round, type: 'planning', promptChars: userMessage.length, skillsIncluded: Object.keys(loadedSkillDocs), responseRaw: raw, durationMs })
      continue
    }

    if (parsed.type === 'discovery') {
      const { requestedSkills, reasoning } = parsed.data
      console.log(`[orchestrator] round=${round} discovery — requested: ${requestedSkills.join(', ')} | reason: ${reasoning}`)

      rounds.push({
        round,
        type: 'discovery',
        promptChars: userMessage.length,
        skillsIncluded: Object.keys(loadedSkillDocs),
        responseRaw: raw,
        durationMs,
        requestedSkills,
      })

      // Track all requested skills across rounds
      requestedSkills.forEach(s => allRequestedSkills.add(s))

      // On the last allowed discovery round, load everything requested and force plan next
      const skillsToLoad = forcePlan
        ? [...allRequestedSkills].filter(s => !(s in loadedSkillDocs))
        : requestedSkills.filter(s => !(s in loadedSkillDocs))

      if (skillsToLoad.length > 0) {
        const newDocs = await loadSkillDocs(skillsToLoad)
        Object.assign(loadedSkillDocs, newDocs)
        console.log(`[orchestrator] loaded skill docs: ${skillsToLoad.join(', ')}`)
      }

      // If this was the last round, the loop will exit — we need to force a plan
      // The forcePlan flag is already set for next iteration
      continue
    }

    // Got a plan
    const roundType = forcePlan ? 'forced-planning' : 'planning'
    rounds.push({ round, type: roundType, promptChars: userMessage.length, skillsIncluded: Object.keys(loadedSkillDocs), responseRaw: raw, durationMs })

    const trace: OrchestratorDebugTrace = {
      totalRounds: rounds.length,
      skillsLoaded: Object.keys(loadedSkillDocs),
      rounds,
    }

    console.log(`[orchestrator] plan complete after ${rounds.length} round(s). skills-loaded: [${Object.keys(loadedSkillDocs).join(', ')}]`)

    return { ...parsed.data, debugTrace: trace }
  }

  // Exhausted all rounds without getting a plan — force one final call
  console.warn('[orchestrator] Exhausted all rounds without a plan. Forcing final planning call.')
  const userMessage = buildUserMessage({ catalog, assets, completedSteps, userIntent, loadedSkillDocs, forcePlan: true })
  const roundStart = Date.now()
  const raw = await callMaverick(userMessage)
  const durationMs = Date.now() - roundStart

  let finalParsed: MaverickResponse
  try {
    finalParsed = parseResponse(raw)
  } catch (err) {
    throw new Error(`Maverick failed to return a valid plan after ${MAX_ROUNDS} rounds. Last response: ${raw.slice(0, 300)}`)
  }

  if (finalParsed.type === 'discovery') {
    throw new Error(`Maverick still requesting skills after ${MAX_ROUNDS} rounds. Aborting.`)
  }

  const trace: OrchestratorDebugTrace = {
    totalRounds: rounds.length + 1,
    skillsLoaded: Object.keys(loadedSkillDocs),
    rounds: [...rounds, { round: MAX_ROUNDS, type: 'forced-planning', promptChars: userMessage.length, skillsIncluded: Object.keys(loadedSkillDocs), responseRaw: raw, durationMs }],
  }

  return { ...finalParsed.data, debugTrace: trace }
}
