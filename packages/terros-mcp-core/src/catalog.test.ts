import { parseEndpoints } from './parser.ts'
import type { EndpointGroups } from './endpoint.ts'
import { buildCatalog, getToolsetNames, toToolsetName } from './catalog.ts'

const endpoint = (path: string, tags?: string[], description?: string, extra: object = {}) => ({
  path,
  ...extra,
  tags,
  summary: `Summary of ${path}`,
  description,
  properties: { type: 'object' as const },
  components: { schemas: {} },
})

const endpoints: EndpointGroups = {
  account: {
    get: endpoint('/account/get', ['Account'], 'Gets one account. Use list for many.'),
    update: endpoint('/account/update', ['Account']),
  },
  event: { list: endpoint('/calendar/event/list', ['Calendar']) },
  customField: { list: endpoint('/customField/list', ['Custom Field']) },
  search: { search: endpoint('/search') },
}

it('names, routes and groups every operation from its path and first tag', () => {
  const catalog = buildCatalog(endpoints)
  expect(catalog.entries.map(({ endpoint: _, ...entry }) => entry)).toEqual([
    {
      name: 'account_get',
      route: 'account/get',
      toolset: 'account',
      summary: 'Gets one account.',
      readOnly: true,
      destructive: false,
    },
    {
      name: 'account_update',
      route: 'account/update',
      toolset: 'account',
      summary: 'Summary of /account/update',
      readOnly: false,
      destructive: false,
    },
    {
      name: 'calendar_event_list',
      route: 'calendar/event/list',
      toolset: 'calendar',
      summary: 'Summary of /calendar/event/list',
      readOnly: true,
      destructive: false,
    },
    {
      name: 'customField_list',
      route: 'customField/list',
      toolset: 'custom-field',
      summary: 'Summary of /customField/list',
      readOnly: true,
      destructive: false,
    },
    {
      name: 'search',
      route: 'search',
      toolset: 'search',
      summary: 'Summary of /search',
      readOnly: true,
      destructive: false,
    },
  ])
  expect(getToolsetNames(catalog)).toEqual(['account', 'calendar', 'custom-field', 'search'])
})

it('keeps only the enabled toolsets and finds entries by tool name', () => {
  const catalog = buildCatalog(endpoints, { toolsets: ['Calendar', 'custom-field'] })
  expect(catalog.entries.map((entry) => entry.name)).toEqual(['calendar_event_list', 'customField_list'])
  expect(catalog.find('calendar_event_list')?.route).toBe('calendar/event/list')
  expect(catalog.find('account_get')).toBeUndefined()
})

it('rejects an unknown toolset', () => {
  expect(() => buildCatalog(endpoints, { toolsets: ['calender'] })).toThrow(
    'Unknown toolset(s): calender. Available: account, calendar, custom-field, search'
  )
})

it('normalizes toolset names', () => {
  expect(toToolsetName('Custom Field')).toBe('custom-field')
  expect(toToolsetName('customField')).toBe('custom-field')
  expect(toToolsetName(' Users/Teams ')).toBe('users-teams')
})

it('classifies reads, writes and destructive operations from spec annotations, then route verbs', () => {
  const classified = buildCatalog({
    user: { profile: endpoint('/user/profile'), add: endpoint('/user/add'), remove: endpoint('/user/remove') },
    account: { match: endpoint('/account/match'), rollback: endpoint('/account/rollback') },
    report: { kpi: endpoint('/report/kpi') },
    location: { query: endpoint('/location/query'), disposition: endpoint('/location/disposition') },
    team: { downline: endpoint('/team/downline', [], '', { readOnly: true }) },
    import: {
      cleanup: endpoint('/import/cleanup', [], '', { destructive: true }),
      errors: endpoint('/import/errors', [], '', { readOnly: true, destructive: true }),
    },
    task: { list: endpoint('/task/list', [], '', { readOnly: false }) },
  }).entries.map((entry) => [entry.name, entry.readOnly ? 'read' : entry.destructive ? 'destructive' : 'write'])
  expect(Object.fromEntries(classified)).toEqual({
    user_profile: 'read',
    user_add: 'write',
    user_remove: 'destructive',
    account_match: 'read',
    account_rollback: 'destructive',
    report_kpi: 'read',
    location_query: 'read',
    location_disposition: 'write',
    team_downline: 'read',
    import_cleanup: 'destructive',
    import_errors: 'read',
    task_list: 'write',
  })
})

it('reads x-terros-readOnly and x-terros-destructive from the OpenAPI document', () => {
  const operation = (extensions: string) => `
    post:
      ${extensions}
      requestBody: { content: { application/json: { schema: { type: object } } } }`
  const document = `
openapi: 3.1.1
paths:
  /export/download:${operation('x-terros-readOnly: true')}
  /import/cleanup:${operation('x-terros-destructive: true')}
  /user/add:${operation('summary: Add User')}
components: { schemas: {} }
`
  const entries = buildCatalog(parseEndpoints(document)).entries
  expect(entries.map(({ name, readOnly, destructive }) => ({ name, readOnly, destructive }))).toEqual([
    { name: 'export_download', readOnly: true, destructive: false },
    { name: 'import_cleanup', readOnly: false, destructive: true },
    { name: 'user_add', readOnly: false, destructive: false },
  ])
})
