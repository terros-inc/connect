import minimist from 'minimist'
import { parseApiLogParams } from './api'

const parse = (args: string[]): ReturnType<typeof parseApiLogParams> => parseApiLogParams(minimist(args))

it('requires a company ID', () => {
  expect(() => parse(['--status', '503'])).toThrow('--companyId')
})

it('parses the log filters', () => {
  expect(
    parse([
      '--companyId',
      'C:example',
      '--endpoint',
      '/account/add',
      '--status',
      '503',
      '--errorsOnly',
      '--since',
      '2026-10-01T00:00:00Z',
      '--limit',
      '50',
    ])
  ).toEqual({
    companyId: 'C:example',
    endpoint: '/account/add',
    status: 503,
    errorsOnly: true,
    since: '2026-10-01T00:00:00Z',
    limit: 50,
  })
})

it('rejects unknown and malformed flags', () => {
  expect(() => parse(['--companyId', 'C:example', '--apiKey', 'x'])).toThrow('--apiKey')
  expect(() => parse(['--companyId', 'C:example', '--status', 'error'])).toThrow('--status must be an integer')
})
