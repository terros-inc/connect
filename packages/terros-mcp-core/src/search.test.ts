import { searchCatalog, tokenize } from './search.ts'
import type { EndpointGroups } from './endpoint.ts'
import { buildCatalog } from './catalog.ts'

const endpoints: EndpointGroups = {
  event: {
    list: {
      path: '/calendar/event/list',
      summary: 'List Calendar Events',
      description: 'Lists calendar events within a date range.',
      tags: ['Calendar'],
      properties: { type: 'object', properties: { ownerId: { type: 'string' } } },
      components: { schemas: {} },
    },
  },
  account: {
    match: {
      path: '/account/match',
      summary: 'Match Account',
      description: 'Finds an existing account by ID or address.',
      tags: ['Account'],
      properties: { $ref: '#/components/schemas/Match' },
      components: { schemas: { Match: { type: 'object', properties: { location: { type: 'object' } } } } },
    },
    list: {
      path: '/account/list',
      summary: 'List Accounts',
      tags: ['Account'],
      properties: { type: 'object' },
      components: { schemas: {} },
    },
  },
}

const catalog = buildCatalog(endpoints)

it('ranks route and title words above description words', () => {
  expect(searchCatalog(catalog, 'list calendar events').map((result) => result.name)).toEqual([
    'calendar_event_list',
    'account_list',
  ])
  expect(searchCatalog(catalog, 'find account by address').map((result) => result.name)).toEqual([
    'account_match',
    'account_list',
  ])
})

it('matches input property names and returns compact results', () => {
  expect(searchCatalog(catalog, 'owner')).toEqual([
    {
      name: 'calendar_event_list',
      summary: 'Lists calendar events within a date range.',
      toolset: 'calendar',
      readOnly: true,
    },
  ])
})

it('returns nothing for unknown words and honours the limit', () => {
  expect(searchCatalog(catalog, 'knock')).toEqual([])
  expect(searchCatalog(catalog, 'list', 1)).toHaveLength(1)
})

it('splits camel case, drops stop words and stems plurals', () => {
  expect(tokenize('List my calendarEvents for the companies')).toEqual(['list', 'calendar', 'event', 'company'])
})
