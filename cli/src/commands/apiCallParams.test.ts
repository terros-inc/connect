import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFileSync, mkdtempSync } from 'node:fs'
import minimist from 'minimist'
import { parseApiCallParams } from './apiCallParams'

const parse = (argv: string[]): ReturnType<typeof parseApiCallParams> => {
  const params = minimist(argv)
  return parseApiCallParams(params, params._.map(String))
}

it('posts the inline body, its fields overriding the input file', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'api-call-')), 'body.json')
  writeFileSync(file, JSON.stringify({ accountId: 'A.example', note: 'from file' }))

  expect(parse(['/account/note/add', '--inputFile', file, '--body', '{"note":"inline"}'])).toEqual({
    path: '/account/note/add',
    body: { accountId: 'A.example', note: 'inline' },
  })
  expect(parse(['user/profile'])).toEqual({ path: 'user/profile', body: {} })
})

// Typed flags would be read as body fields and silently dropped, sending a different request than the one asked for.
it('refuses request fields passed as flags', () => {
  expect(() => parse(['/account/get', '--accountId', 'A.example'])).toThrow(
    'Unknown parameter(s): --accountId. Send request fields in --body or --inputFile.'
  )
})

it.each([['--body'], ['--body', '[1]'], ['--body', 'not json'], ['--body', '7']])(
  'refuses a body that is not a JSON object: %s',
  (...flag) => {
    expect(() => parse(['/account/get', ...flag])).toThrow('--body expects a JSON object')
  }
)

// A full URL is still sent to the configured host, so accepting it would call a different endpoint than the one named.
it('refuses a URL in place of a path', () => {
  expect(() => parse(['https://api.example.test/account/get'])).toThrow('Set TERROS_API_ENDPOINT to change the host')
})

it('takes exactly one path', () => {
  expect(() => parse([])).toThrow('usage: terros api call <path>')
  expect(() => parse(['POST', '/account/get'])).toThrow('usage: terros api call <path>')
})
