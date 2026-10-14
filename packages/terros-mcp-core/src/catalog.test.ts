import type { EndpointGroups } from './endpoint.ts'
import { buildCatalog, getToolsetNames, toToolsetName } from './catalog.ts'

const endpoint = (path: string, tags?: string[], description?: string) => ({
  path,
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
    { name: 'account_get', route: 'account/get', toolset: 'account', summary: 'Gets one account.', readOnly: true },
    {
      name: 'account_update',
      route: 'account/update',
      toolset: 'account',
      summary: 'Summary of /account/update',
      readOnly: false,
    },
    {
      name: 'calendar_event_list',
      route: 'calendar/event/list',
      toolset: 'calendar',
      summary: 'Summary of /calendar/event/list',
      readOnly: true,
    },
    {
      name: 'customField_list',
      route: 'customField/list',
      toolset: 'custom-field',
      summary: 'Summary of /customField/list',
      readOnly: true,
    },
    { name: 'search', route: 'search', toolset: 'search', summary: 'Summary of /search', readOnly: true },
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
