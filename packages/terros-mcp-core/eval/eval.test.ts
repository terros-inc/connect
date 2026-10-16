import { readFileSync } from 'node:fs'
import { runEval } from './run.ts'

// CI downloads the public document to cli/terros.yml before tests (`pnpm fetch-openapi` in cli).
const spec = readFileSync(new URL('../../../cli/terros.yml', import.meta.url), 'utf8')

it(
  'completes the scripted tasks in every mode, except a task outside the enabled toolsets',
  { timeout: 60_000 },
  async () => {
    const results = await runEval(spec, 1)
    const outcomes = results.map(
      (result) => `${result.config} ${result.task} ${result.success ? 'ok' : result.failure}`
    )
    expect(outcomes).toEqual([
      'endpoints (all) appointments-today ok',
      'endpoints (all) log-knock ok',
      'endpoints (all) find-account-by-address ok',
      'endpoints (all) my-tasks ok',
      'endpoints (all) account-custom-fields ok',
      'toolsets (field sales) appointments-today ok',
      'toolsets (field sales) log-knock ok',
      'toolsets (field sales) find-account-by-address ok',
      'toolsets (field sales) my-tasks ok',
      'toolsets (field sales) account-custom-fields customField_list is not in the tool list',
      'meta appointments-today ok',
      'meta log-knock ok',
      'meta find-account-by-address ok',
      'meta my-tasks ok',
      'meta account-custom-fields ok',
    ])
  }
)
