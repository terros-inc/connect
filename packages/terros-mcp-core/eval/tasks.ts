/**
 * Scripted evaluation tasks. Each step is the API operation an agent must reach, the arguments it sends, and the
 * search queries it would try in meta mode, in order: first the task's own words, then a rewording.
 * The fixtures use placeholder data only (this repository is public).
 */
export type EvalStep = {
  tool: string
  args: Record<string, unknown>
  queries: string[]
}

export type EvalTask = {
  id: string
  prompt: string
  steps: EvalStep[]
  /** Text the final API response must contain. */
  expect: string
}

const DAY_START = Date.UTC(2026, 9, 14)
const DAY_END = DAY_START + 24 * 60 * 60 * 1000 - 1

const ADDRESS = {
  line1: '123 Example St',
  locality: 'Springfield',
  countrySubd: 'UT',
  postal1: '84000',
  latlng: { latitude: 40.0, longitude: -111.0 },
}

export const EVAL_TASKS: EvalTask[] = [
  {
    id: 'appointments-today',
    prompt: 'List my appointments today',
    steps: [
      { tool: 'user_profile', args: {}, queries: ['my user profile', 'current user'] },
      {
        tool: 'calendar_event_list',
        args: { startTime: DAY_START, endTime: DAY_END, ownerId: 'U.example' },
        queries: ['list my appointments today', 'list calendar events'],
      },
    ],
    expect: 'Consultation with Acme Solar lead',
  },
  {
    id: 'log-knock',
    prompt: 'Log a knock at 123 Example St: nobody was home',
    steps: [
      { tool: 'disposition_list', args: {}, queries: ['knock outcomes nobody home', 'list dispositions'] },
      {
        tool: 'location_disposition',
        args: { dispositionId: 'Disposition.example', location: ADDRESS },
        queries: ['log a knock', 'disposition location'],
      },
    ],
    expect: 'Location.example',
  },
  {
    id: 'find-account-by-address',
    prompt: 'Find the account at 123 Example St',
    steps: [
      {
        tool: 'account_match',
        args: { location: { line1: ADDRESS.line1, locality: ADDRESS.locality, countrySubd: ADDRESS.countrySubd } },
        queries: ['find account by address', 'match account'],
      },
    ],
    expect: 'Acme Solar',
  },
  {
    id: 'my-tasks',
    prompt: 'What tasks do I have?',
    steps: [{ tool: 'task_list', args: {}, queries: ['my tasks', 'list tasks'] }],
    expect: 'Call back the homeowner',
  },
  {
    id: 'account-custom-fields',
    prompt: 'Which custom fields do accounts have?',
    steps: [
      {
        tool: 'customField_list',
        args: { tableType: 'Account' },
        queries: ['account custom fields', 'list custom fields'],
      },
    ],
    expect: 'Roof age',
  },
]

/** Canned API responses by route. Anything not listed returns `{ type: 'success' }`. */
export const MOCK_RESPONSES = new Map<string, unknown>([
  [
    'user/profile',
    { type: 'success', user: { userId: 'U.example', name: 'Pat Example' }, company: { companyId: 'C.example' } },
  ],
  [
    'calendar/event/list',
    {
      type: 'success',
      events: [{ eventId: 'E.example', title: 'Consultation with Acme Solar lead', startTime: DAY_START + 3600000 }],
    },
  ],
  ['disposition/list', { type: 'success', dispositions: [{ dispositionId: 'Disposition.example', name: 'Not Home' }] }],
  ['location/disposition', { type: 'success', locationId: 'Location.example' }],
  ['account/match', { type: 'success', accounts: [{ accountId: 'Account.example', name: 'Acme Solar' }] }],
  ['task/list', { type: 'success', tasks: [{ taskId: 'Task.example', title: 'Call back the homeowner' }] }],
  ['customField/list', { type: 'success', customFields: [{ customFieldId: 'CF.example', name: 'Roof age' }] }],
])

/** Toolsets a field-sales connection would enable in grouped mode. */
export const FIELD_SALES_TOOLSETS = ['account', 'calendar', 'disposition', 'location', 'search', 'task', 'team', 'user']
