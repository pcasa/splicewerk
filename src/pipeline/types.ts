// ─── Pipeline Types ───────────────────────────────────────────────────────────

export interface FunctionInput {
  name: string
  type: 'asset' | 'string' | 'number' | 'boolean' | 'string[]'
  description: string
  required: boolean
}

export interface FunctionOutput {
  name: string
  description: string
}

export interface FunctionManifest {
  name: string
  description: string
  inputs: FunctionInput[]
  outputs: FunctionOutput[]
  /** Rough estimate — helps Maverick reason about scheduling */
  estimatedSeconds: number
}

/** What a pipeline function exports from its module */
export type ExecuteFn = (
  inputs: Record<string, unknown>,
  assets: AssetState,
  projectDir: string
) => Promise<Record<string, string>>

export interface RegisteredFunction {
  manifest: FunctionManifest
  execute: ExecuteFn
}

/** Logical asset names → absolute file paths */
export type AssetState = Record<string, string>

export interface PlannedStep {
  id: string
  functionName: string
  inputs: Record<string, unknown>
}

export interface OrchestratorPlan {
  done: boolean
  reasoning: string
  nextSteps: PlannedStep[]
  /** Attached by orchestrator for debugging — visible in Inngest run output */
  debugTrace?: OrchestratorDebugTrace
}

/** Maverick's response when it needs more capability details before planning */
export interface DiscoveryResponse {
  phase: 'discovery'
  requestedSkills: string[]
  reasoning: string
}

export interface OrchestratorDebugTrace {
  totalRounds: number
  skillsLoaded: string[]
  rounds: OrchestratorRound[]
}

export interface OrchestratorRound {
  round: number
  type: 'discovery' | 'planning' | 'forced-planning'
  /** Character count of the full prompt sent */
  promptChars: number
  /** Skill docs included in this round */
  skillsIncluded: string[]
  /** Raw response from Maverick */
  responseRaw: string
  durationMs: number
  requestedSkills?: string[]
}

export interface CompletedStep {
  id: string
  functionName: string
  inputs: Record<string, unknown>
  outputs: Record<string, string>
  durationMs: number
}

export interface PipelineState {
  projectDir: string
  assets: AssetState
  userIntent: string
  completedSteps: CompletedStep[]
}

/** Event shape for the adaptive pipeline Inngest function */
export type AdaptivePipelineEvent = {
  name: 'pipeline/run'
  data: {
    projectDir: string
    /** Initial assets available at pipeline start */
    assets: AssetState
    /** Human-readable description of desired outcome */
    userIntent: string
  }
}
