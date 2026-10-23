import { CommandCollisionError } from '@terros-inc/mcp-core'
import { BUILTINS_EXTENSION, checkReleaseSchema } from './releaseSchema'
import type { CommandRegistry } from './commands/types'

const run = vi.fn()
const registry: CommandRegistry = {
  auth: { description: 'auth', subcommands: { login: { description: 'login', run } } },
  connect: { description: 'connect', subcommands: { publish: { description: 'publish', run } } },
  mcp: { description: 'mcp', run, subcommands: {} },
}
const builtins = ['auth login', 'connect publish', 'mcp']

const schema = (paths: string[], listed: string[] | 'omit' = builtins): string =>
  JSON.stringify({
    openapi: '3.1.1',
    ...(listed === 'omit' ? {} : { [BUILTINS_EXTENSION]: listed }),
    paths: Object.fromEntries(
      paths.map((path) => [
        path,
        { post: { summary: path, requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } } },
      ])
    ),
    components: { schemas: {} },
  })

describe('checkReleaseSchema', () => {
  it('accepts a schema that shares a built-in group and lists every built-in', () => {
    expect(() =>
      checkReleaseSchema(schema(['/connect/app/list', '/mcp/start'], [...builtins, 'whoami']), registry)
    ).not.toThrow()
  })

  // A bundled schema with a collision would fail every command of that release at runtime, `auth login` included.
  it.each([['/connect/publish'], ['/auth/login/sso'], ['/mcp']])('fails when %s lands on a built-in', (path) => {
    expect(() => checkReleaseSchema(schema(['/account/get', path]), registry)).toThrow(CommandCollisionError)
  })

  it('fails on a help segment', () => {
    expect(() => checkReleaseSchema(schema(['/account/help']), registry)).toThrow(/reserved command word "help"/)
  })

  // A built-in the document does not list is one the API's lint lets a new endpoint path land on.
  it('fails naming each built-in the document does not list', () => {
    expect(() => checkReleaseSchema(schema(['/account/get'], ['auth login']), registry)).toThrow(
      'does not list terros connect publish, terros mcp under x-terros-cli-builtins'
    )
    expect(() => checkReleaseSchema(schema(['/account/get'], 'omit'), registry)).toThrow(
      'does not list terros auth login, terros connect publish, terros mcp'
    )
  })
})
