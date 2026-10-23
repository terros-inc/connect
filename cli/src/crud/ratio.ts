import type { Endpoints } from '@terros-inc/mcp-core'

const components = { schemas: {} }

/** Read-only ratio endpoints that are not part of the bundled public OpenAPI document. */
export const ratioReadEndpoints: Endpoints = {
  get: {
    path: '/ratio/get',
    description:
      'Get one ratio or formula custom stat, including its inputs, formula, filters, formatting, and modification history.',
    properties: {
      type: 'object',
      required: ['ratioId'],
      properties: {
        ratioId: { type: 'string', description: 'Custom stat ID.' },
      },
    },
    components,
  },
  list: {
    path: '/ratio/list',
    description:
      'List ratio and formula custom stats with their inputs, formulas, filters, formatting, and modification history.',
    properties: {
      type: 'object',
      properties: {
        scopeId: { type: 'string', description: 'Only return custom stats in this company, team, or user scope.' },
        workflowId: { type: 'string', description: 'Only return custom stats for this workflow.' },
      },
    },
    components,
  },
}
