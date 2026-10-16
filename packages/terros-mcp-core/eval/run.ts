import { readFileSync } from 'node:fs'
import { buildCatalog, createMcpServer, parseEndpoints, searchCatalog, formatSearchResults } from '../src/index.ts'
import { EVAL_TASKS, FIELD_SALES_TOOLSETS } from './tasks.ts'
import { estimateTokens, runTask, type EvalConfig, type TaskResult } from './harness.ts'

export const EVAL_CONFIGS: EvalConfig[] = [
  { label: 'endpoints (all)', mode: 'endpoints' },
  { label: 'toolsets (field sales)', mode: 'endpoints', toolsets: FIELD_SALES_TOOLSETS },
  { label: 'meta', mode: 'meta' },
]

/** Run every task in every configuration `runs` times and keep the median latency of each. */
export async function runEval(spec: string, runs = 5): Promise<TaskResult[]> {
  const endpoints = parseEndpoints(spec)
  const results: TaskResult[] = []
  for (const config of EVAL_CONFIGS) {
    for (const task of EVAL_TASKS) {
      const attempts: TaskResult[] = []
      for (let run = 0; run < runs; run++) attempts.push(await runTask(endpoints, config, task))
      const sorted = attempts.toSorted((left, right) => left.milliseconds - right.milliseconds)
      results.push(sorted[Math.floor(sorted.length / 2)]!)
    }
  }
  return results
}

export function formatResults(results: TaskResult[]): string {
  const header =
    '| Config | Task | OK | Tool calls | Missed searches | Tool-definition tokens | Input tokens (est.) | ms (median) |'
  const rows = results.map(
    (result) =>
      `| ${result.config} | ${result.task} | ${result.success ? 'yes' : `no: ${result.failure}`} | ${result.toolCalls} | ` +
      `${result.missedSearches} | ${result.toolDefinitionTokens} | ${result.inputTokens} | ${result.milliseconds.toFixed(1)} |`
  )
  return [header, '| --- | --- | --- | --- | --- | --- | --- | --- |', ...rows].join('\n')
}

export type SetupTiming = { mode: string; coldMilliseconds: number; warmMilliseconds: number }

/**
 * Time to build a server, first from freshly parsed endpoints (cold: a new process, or the first request after a
 * tool-list reload) and then again from the same endpoints (warm: every later request of a stateless HTTP server).
 */
export function measureSetup(spec: string): SetupTiming[] {
  return EVAL_CONFIGS.map((config) => {
    const endpoints = parseEndpoints(spec)
    const build = (): number => {
      const started = performance.now()
      createMcpServer({ endpoints, client: { call: async () => ({}) as never }, version: 'eval', ...config })
      return performance.now() - started
    }
    return { mode: config.label, coldMilliseconds: build(), warmMilliseconds: build() }
  })
}

export type SearchFormat = { query: string; lineTokens: number; jsonTokens: number }

/** Token cost of the compact one-line search format against the same results as JSON. */
export function compareSearchFormats(spec: string): SearchFormat[] {
  const catalog = buildCatalog(parseEndpoints(spec))
  return EVAL_TASKS.flatMap((task) => task.steps.map((step) => step.queries[0]!)).map((query) => {
    const results = searchCatalog(catalog, query)
    return {
      query,
      lineTokens: estimateTokens(formatSearchResults(results, [])),
      jsonTokens: estimateTokens(JSON.stringify(results)),
    }
  })
}

function formatSetup(timings: SetupTiming[]): string {
  const rows = timings.map(
    (timing) => `| ${timing.mode} | ${timing.coldMilliseconds.toFixed(1)} | ${timing.warmMilliseconds.toFixed(1)} |`
  )
  return ['| Config | Server build, cold (ms) | Server build, warm (ms) |', '| --- | --- | --- |', ...rows].join('\n')
}

function formatSearch(formats: SearchFormat[]): string {
  const rows = formats.map((format) => `| ${format.query} | ${format.lineTokens} | ${format.jsonTokens} |`)
  return ['| First query | Lines (tokens) | JSON (tokens) |', '| --- | --- | --- |', ...rows].join('\n')
}

if (import.meta.main) {
  const path = process.argv[2] ?? new URL('../../../cli/terros.yml', import.meta.url).pathname
  const spec = readFileSync(path, 'utf8')
  console.log(formatSetup(measureSetup(spec)))
  console.log()
  console.log(formatResults(await runEval(spec)))
  console.log()
  console.log(formatSearch(compareSearchFormats(spec)))
}
