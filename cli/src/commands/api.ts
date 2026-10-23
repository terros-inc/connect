import type { ParsedArgs } from 'minimist'
import { loadEndpoints } from '../loadEndpoints'
import { clearOpenApiCache } from '../cache'
import { runApiHistoryQuery } from '../apiHistory'
import { buildTerrosClient } from '../api/query'
import { apiLogParameters, parseApiLogParams } from './apiLogParams'

export const apiCommands = {
  refresh: {
    description:
      'Refresh the cached API schema. Then retry the endpoint command. If it is still unavailable, check whether it appears in the API schema and is available to your account.',
    async run(): Promise<void> {
      await clearOpenApiCache()
      await loadEndpoints()
      console.log(
        'API schema refreshed. Retry the endpoint command. If it is still unavailable, check whether it appears in the API schema and is available to your account.'
      )
    },
  },
  log: {
    description:
      "Show a company's recent API requests from the last seven days, newest first. Requires internal access.",
    parameters: apiLogParameters,
    async run({ params }: { params: ParsedArgs }): Promise<void> {
      const result = await runApiHistoryQuery(buildTerrosClient(), parseApiLogParams(params))
      if (result.sinceClipped)
        console.error(`Requested --since was clipped to the seven-day limit (${result.effectiveSince ?? 'unknown'})`)
      console.log(JSON.stringify(result.requests ?? [], null, 2))
    },
  },
}
