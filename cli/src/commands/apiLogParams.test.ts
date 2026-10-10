import minimist from 'minimist'
import { parseApiLogParams } from './apiLogParams'

const parse = (args: string[]): ReturnType<typeof parseApiLogParams> => parseApiLogParams(minimist(args))

it('requires a company ID', () => {
  expect(() => parse(['--errorsOnly'])).toThrow('--companyId')
})

it('parses the log filters', () => {
  expect(
    parse([
      '--companyId',
      'C:example',
      '--endpoint',
      '/account/add',
      '--errorsOnly',
      '--since',
      '2026-10-01T00:00:00Z',
      '--limit',
      '50',
    ])
  ).toEqual({
    companyId: 'C:example',
    endpoint: '/account/add',
    errorsOnly: true,
    since: '2026-10-01T00:00:00Z',
    limit: 50,
  })
})

it('rejects unknown and malformed flags', () => {
  expect(() => parse(['--companyId', 'C:example', '--apiKey', 'x'])).toThrow('--apiKey')
  expect(() => parse(['--companyId', 'C:example', '--status', '503'])).toThrow('--status')
})
