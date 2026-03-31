import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RegisteredFunction } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FUNCTIONS_DIR = join(__dirname, 'functions')

let _registry: Map<string, RegisteredFunction> | null = null

/**
 * Auto-discovers pipeline functions from src/pipeline/functions/*.ts
 * Every file that exports `manifest` + `execute` is registered.
 * Result is cached after first load.
 */
export async function getRegistry(): Promise<Map<string, RegisteredFunction>> {
  if (_registry) return _registry

  _registry = new Map()

  let files: string[]
  try {
    files = readdirSync(FUNCTIONS_DIR).filter(
      f => (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts')
    )
  } catch {
    console.warn('[registry] functions directory not found:', FUNCTIONS_DIR)
    return _registry
  }

  for (const file of files) {
    try {
      const mod = await import(join(FUNCTIONS_DIR, file)) as Record<string, unknown>
      if (mod.manifest && mod.execute) {
        const fn = mod as unknown as RegisteredFunction
        _registry.set(fn.manifest.name, fn)
        console.log(`[registry] Loaded: ${fn.manifest.name}`)
      }
    } catch (err) {
      console.warn(`[registry] Failed to load ${file}:`, err)
    }
  }

  console.log(`[registry] ${_registry.size} functions registered`)
  return _registry
}

/** Force reload on next getRegistry() call (e.g. after hot reload) */
export function invalidateRegistry(): void {
  _registry = null
}

/** Returns a formatted function catalog for the Maverick prompt */
export async function buildFunctionCatalog(): Promise<string> {
  const registry = await getRegistry()
  const lines: string[] = []

  for (const [, fn] of registry) {
    const { manifest } = fn
    const inputs = manifest.inputs
      .map(i => `${i.name}${i.required ? '' : '?'} (${i.type}): ${i.description}`)
      .join('; ')
    const outputs = manifest.outputs
      .map(o => `${o.name}: ${o.description}`)
      .join('; ')
    lines.push(
      `- **${manifest.name}**: ${manifest.description}\n` +
      `  Inputs: ${inputs}\n` +
      `  Outputs: ${outputs}\n` +
      `  EstimatedSeconds: ${manifest.estimatedSeconds}`
    )
  }

  return lines.join('\n\n')
}
