import type { ParsedArgs } from 'minimist'
import { runApiHistoryQuery } from '../apiHistory'
import { buildTerrosClient } from '../api/query'
import { parseApiLogParams } from './apiLogParams'

export const apiCommands = {
  log: {
    description:
      "Show a company's recent API requests, newest first. Requires internal access. " +
      'Flags: --companyId (required), --endpoint /path, --errorsOnly, --since <ISO time>, --limit <1-100>',
    async run({ params }: { params: ParsedArgs }): Promise<void> {
      const result = await runApiHistoryQuery(buildTerrosClient(), parseApiLogParams(params))
      if (result.sinceClipped)
        console.error(`Requested --since was clipped to the seven-day limit (${result.effectiveSince ?? 'unknown'})`)
      console.log(JSON.stringify(result.requests ?? [], null, 2))
    },
  },
}
