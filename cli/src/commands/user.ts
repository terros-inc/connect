import type { ParsedArgs } from 'minimist'
import type { EndpointParameter } from '@terros-inc/mcp-core'
import { getUserLoginHistory } from '../userLoginHistory'
import { buildTerrosClient } from '../api/query'

const loginHistoryParameters: EndpointParameter[] = [
  {
    name: 'userId',
    type: 'string',
    required: true,
    description: 'User whose recorded sign-in events to list',
  },
]

export const userCommands = {
  'login-history': {
    description: 'Show recorded sign-in events, newest first, including each recorded outcome and description.',
    parameters: loginHistoryParameters,
    async run({ params }: { params: ParsedArgs }): Promise<void> {
      const unknown = Object.keys(params).filter((name) => name !== '_' && name !== 'userId')
      if (unknown.length > 0) throw new Error(`Unknown parameter(s): ${unknown.map((name) => `--${name}`).join(', ')}`)
      if (typeof params.userId !== 'string' || params.userId === '') {
        throw new Error('Missing required parameter: --userId')
      }

      const history = await getUserLoginHistory(buildTerrosClient(), params.userId)
      console.log(JSON.stringify(history, null, 2))
    },
  },
}
