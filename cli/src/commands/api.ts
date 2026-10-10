import type { ParsedArgs } from 'minimist'
import { runApiHistoryQuery } from '../apiHistory'
import { buildTerrosClient } from '../api/query'
import { parseApiLogParams } from './apiLogParams'

export const apiCommands = {
  log: {
    description:
      "Show a company's recent API requests, newest first, including requests that timed out. Requires internal access. " +
      'Flags: --companyId (required), --endpoint /path, --status <HTTP status>, --errorsOnly, --since <ISO time>, --limit <1-100>',
    async run({ params }: { params: ParsedArgs }): Promise<void> {
      const result = await runApiHistoryQuery(buildTerrosClient(), parseApiLogParams(params))
      console.log(JSON.stringify(result.requests ?? [], null, 2))
    },
  },
}
