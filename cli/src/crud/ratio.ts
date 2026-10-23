import type { Endpoints, Schema } from '@terros-inc/mcp-core'

const components = { schemas: {} }

const INPUT_KPI_HELP = `
Input KPIs for numerator, denominator, and formula scopes must be numeric \`value\`s returned by
\`terros report column --columnTypes number\` for the same workflow. Common fixed values are \`contact.pitch\`,
\`contact.pitches\`, \`contact.daysWorked\`, \`meeting.checkin\`, \`meetingAttendance.count\`,
\`conversation.averageScore\`, \`conversation.count\`, and \`conversation.activeHours\`. The allowed dynamic
families are workflow action counts; setter, closer, and account stage counts; numeric custom fields; and existing
custom stats. Availability depends on the selected workflow, reporting configuration, and the caller's permissions.
`.trim()

const ADD_DESCRIPTION = `
Add a custom stat. Use type \`ratio\` or \`percentage\` with numerator and denominator for a custom ratio. Use
type \`formula\` with formula and scopes for an advanced custom stat. ${INPUT_KPI_HELP}

Custom ratio example:
  terros ratio add --ratio '{"scopeId":"C.example","name":"Close Rate","type":"percentage","numerator":"setter|S.closed|count","denominator":"contact.pitches"}'

Advanced custom stat example:
  terros ratio add --ratio '{"scopeId":"C.example","name":"Revenue per Pitch","type":"formula","formula":"$Revenue / $Pitch","scopes":{"$Revenue":"cf|account|sum|CF.revenue|createdDate","$Pitch":"contact.pitches"}}'
`.trim()

const UPDATE_DESCRIPTION = `
Update a custom stat by sending its complete definition, including ratioId and scopeId. Custom ratios use type
\`ratio\` or \`percentage\`; advanced custom stats use type \`formula\`. ${INPUT_KPI_HELP}

Example:
  terros ratio update --ratio '{"ratioId":"Ratio.example","scopeId":"C.example","name":"Close Rate","type":"percentage","numerator":"setter|S.closed|count","denominator":"contact.pitches"}'
`.trim()

const ratioProperties: Record<string, Schema> = {
  name: { type: 'string' },
  description: { type: 'string' },
  short: { type: 'string' },
  plural: { type: 'string' },
  scopeId: { type: 'string' },
  workflowId: { type: 'string' },
}

const fractionalProperties: Record<string, Schema> = {
  ...ratioProperties,
  type: { type: 'string', enum: ['ratio', 'percentage'] },
  numerator: { type: 'string' },
  denominator: { type: 'string' },
}

const formulaProperties: Record<string, Schema> = {
  ...ratioProperties,
  type: { type: 'string', enum: ['formula'] },
  formula: { type: 'string' },
  scopes: { type: 'object', additionalProperties: { type: 'string' } },
  formatter: {
    oneOf: [
      {
        type: 'string',
        enum: ['round', 'ceiling', 'floor', 'daysSince', 'timeOfDay', 'ratio', 'percentage', 'formula'],
      },
      {
        type: 'object',
        properties: {
          prefix: { type: 'string' },
          suffix: { type: 'string' },
          decimalPlaces: { type: 'number' },
          delimiter: { type: 'string' },
          separator: { type: 'string' },
        },
      },
    ],
  },
  accumulator: { type: 'string', enum: ['sum', 'min', 'max', 'avg', 'median', 'distinct', 'query'] },
}

function ratioVariants(saved: boolean): Schema[] {
  const savedProperties: Record<string, Schema> = saved
    ? { ratioId: { type: 'string' }, scopeId: { type: 'string' } }
    : {}
  const savedRequired = saved ? ['ratioId', 'scopeId'] : []
  return [
    {
      type: 'object',
      properties: { ...fractionalProperties, ...savedProperties },
      required: [...savedRequired, 'name', 'type', 'numerator', 'denominator'],
    },
    {
      type: 'object',
      properties: { ...formulaProperties, ...savedProperties },
      required: [...savedRequired, 'name', 'type', 'formula', 'scopes'],
    },
  ]
}

/** Ratio endpoints that are not part of the bundled public OpenAPI document. */
export const ratioEndpoints: Endpoints = {
  add: {
    path: '/ratio/add',
    description: ADD_DESCRIPTION,
    properties: {
      type: 'object',
      properties: {
        ratio: { description: 'The complete custom-stat definition.', oneOf: ratioVariants(false) },
      },
      required: ['ratio'],
    },
    components,
  },
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
  remove: {
    path: '/ratio/remove',
    description: `Remove either kind of custom stat by its ratio ID.\n\nExample:\n  terros ratio remove --ratioId Ratio.example`,
    properties: {
      type: 'object',
      properties: { ratioId: { type: 'string' } },
      required: ['ratioId'],
    },
    components,
  },
  update: {
    path: '/ratio/update',
    description: UPDATE_DESCRIPTION,
    properties: {
      type: 'object',
      properties: {
        ratio: { description: 'The complete saved custom-stat definition.', oneOf: ratioVariants(true) },
      },
      required: ['ratio'],
    },
    components,
  },
}
