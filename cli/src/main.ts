import { interactiveSignInRefusal, resolveEnvironment } from '@terros-inc/connect-common'
import {
  buildEndpointInput,
  CommandCollisionError,
  UnknownParameterError,
  DEFAULT_TYPE_DEPTH,
  getEndpointInputParameters,
  getExampleArguments,
  matchesStringLiteral,
  type EndpointGroups,
  type CommandNode,
  type EndpointParameter,
  UPLOAD_URL_KEYS,
  withoutUploadUrls,
} from '@terros-inc/mcp-core'
import minimist from 'minimist'
import packageJson from '../package.json'
import { buildTerrosClient } from './api/query'
import { runApiHistoryQuery } from './apiHistory'
import { signInWithSensitiveScope } from './auth/auth0'
import { clearOpenApiCache } from './cache'
import { commandRegistry, getCommandGroup } from './commands'
import {
  buildCliCommandTree,
  checkBuiltinCollisions,
  findBuiltin,
  formatBuiltinHelp,
  matchCommand,
  type CommandLevel,
} from './commandTree'
import { formatOutput } from './formatOutput'
import { companyScopeHint, impersonationFlagMessage } from './impersonation'
import { readInputFile } from './inputFile'
import {
  loadEndpoints,
  loadEndpointsAfterRefresh,
  loadPublicEndpoints,
  loadOfflineEndpoints,
  type SchemaStatus,
} from './loadEndpoints'
import {
  formatCommandsHelp,
  formatCommandUsage,
  formatSubcommandParametersHelp,
  formatSubcommandsHelp,
  HELP_PARENT_MESSAGE,
  quoteShellArgument,
  formatFlagArgument,
  preserveNumericString,
  getArrayParameterSyntax,
} from './messages'
import { reportError } from './reportError'
import { readUploadFile, UPLOAD_FILE_FLAG, uploadToResponse } from './uploadFile'

/** A negative number, in the forms minimist itself reads as a number: `-124.5`, `-3`, `-.5`, `-1e-3`. */
const NEGATIVE_NUMBER = /^-(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i

/**
 * Parse the command line, reading a negative number after a long flag as that flag's value. minimist alone reads
 * `--longitude -124.5` as `--longitude` plus the short flags `-1`, `-2` and `-4`, so it is joined into
 * `--longitude=-124.5` first. Short flags and words after `--` are left to minimist unchanged.
 */
export function parseArgv(argv: string[]): minimist.ParsedArgs {
  const joined: string[] = []
  for (const [index, arg] of argv.entries()) {
    if (arg === '--') {
      joined.push(...argv.slice(index))
      break
    }
    const previous = joined.at(-1)
    if (NEGATIVE_NUMBER.test(arg) && previous?.startsWith('--') && previous.length > 2 && !previous.includes('=')) {
      joined[joined.length - 1] = `${previous}=${arg}`
      continue
    }
    joined.push(arg)
  }
  return minimist(joined)
}

/**
 * Run the CLI, printing a failure as its one-line message on standard error and exiting 1. Causes and stack traces are
 * for debugging, so only `TERROS_DEBUG=1` prints the whole error.
 */
export async function runCli(argv: string[]): Promise<void> {
  // Held until the error is reported, so a failure is labelled with the environment it ran against.
  let restore = (): void => {}
  try {
    const scope = applyEnvFlag(argv)
    restore = scope.restore
    await main(scope.argv)
  } catch (error) {
    if (process.env.TERROS_DEBUG === '1' || !(error instanceof Error)) reportError(error)
    else reportError(error.message)
    process.exitCode = 1
  } finally {
    restore()
  }
}

/** Agents and people type these out of habit; they ask for help wherever they appear, as a trailing `help` word does. */
const HELP_FLAGS = new Set(['--help', '-h'])
/** The API paths that issue an API key. */
const SENSITIVE_PATHS = new Set(['/apikey/add', '/apikey/restricted/add'])
const INCLUDE_UPLOAD_URLS = 'includeUploadUrls'

/**
 * Moves `--env <name>` (staff only, deliberately absent from help) into TERROS_ENV, because the sign-in and schema
 * storage read the environment before any command parses its flags, and so the flag cannot clash with an API field.
 */
function applyEnvFlag(argv: string[]): { argv: string[]; restore: () => void } {
  const previous = process.env.TERROS_ENV
  const restore = (): void => {
    if (previous === undefined) delete process.env.TERROS_ENV
    else process.env.TERROS_ENV = previous
  }
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') {
      rest.push(...argv.slice(i))
      break
    }
    if (arg !== '--env' && !arg.startsWith('--env=')) {
      rest.push(arg)
      continue
    }
    const value = arg === '--env' ? argv[++i] : arg.slice('--env='.length)
    if (!value?.trim() || value.startsWith('--')) {
      restore()
      throw new Error('--env needs a value: prod, staging, or a developer stack name.')
    }
    process.env.TERROS_ENV = value
  }
  return { argv: rest, restore }
}

export async function main(args: string[]): Promise<void> {
  const scope = applyEnvFlag(args)
  try {
    await run(scope.argv)
  } finally {
    // main is exported and may run again in this process; the next call must not inherit this call's --env.
    scope.restore()
  }
}

async function run(argv: string[]): Promise<void> {
  const optionsEnd = argv.includes('--') ? argv.indexOf('--') : argv.length
  const helpFlag = argv.slice(0, optionsEnd).some((arg) => HELP_FLAGS.has(arg))
  const versionFlag = argv.slice(0, optionsEnd).some((arg) => arg === '--version' || arg === '-v')
  const params = parseArgv(argv.filter((arg, index) => index >= optionsEnd || !HELP_FLAGS.has(arg)))
  const words = params._.map(String)
  // Help is checked before any command runs, so `--help` can never start one (such as an interactive sign-in).
  if (helpFlag || words.at(-1) === 'help') {
    await showHelp(words.at(-1) === 'help' ? words.slice(0, -1) : words, params.depth)
    return
  }

  if (versionFlag || params.v === true || params.version === true) {
    console.log(packageJson.version)
    return
  }

  if (words.length === 0) {
    console.log(HELP_PARENT_MESSAGE)
    return
  }

  const builtin = findBuiltin(commandRegistry, words)
  if (builtin) {
    if (!(words[0] === 'api' && words[1] === 'refresh')) {
      await checkBuiltinCollisions(words[0] === 'connect' ? loadPublicEndpoints : loadEndpoints, commandRegistry, words)
    }
    await builtin.run({ params, args: builtin.args })
    return
  }

  let { level, refreshStatus } = await loadCommandLevelWithRefresh(words, argv)
  const arrayHint = arrayFlagHint(argv, level)
  if (level.unmatched.length > 0 || arrayHint) {
    reportError(arrayHint ?? unknownCommandMessage(words, level, refreshStatus))
    console.log(formatLevelHelp(level))
    process.exitCode = 1
    return
  }

  let endpoint = level.node.endpoint
  if (!endpoint) {
    console.log(formatLevelHelp(level))
    return
  }

  const { params: inputFlags, upload } = readUploadFile(params)
  const { params: flags, base } = readInputFile(inputFlags)
  let input: object
  try {
    input = buildEndpointInput(endpoint, flags, base)
  } catch (error) {
    if (!(error instanceof UnknownParameterError)) throw error
    const impersonationMessage = impersonationFlagMessage(error.parameters)
    if (impersonationMessage !== undefined) {
      reportError(impersonationMessage)
      process.exitCode = 1
      return
    }
    if (refreshStatus !== undefined) {
      reportError(unknownParameterMessage(error, refreshStatus))
      process.exitCode = 1
      return
    }

    await clearOpenApiCache()
    const refreshed = await loadEndpointsAfterRefresh()
    refreshStatus = refreshed.schemaStatus
    level = await loadCommandLevel(words, Promise.resolve(refreshed.endpoints))
    if (level.unmatched.length > 0 || !level.node.endpoint) {
      reportError(unknownCommandMessage(words, level, refreshStatus))
      console.log(formatLevelHelp(level))
      process.exitCode = 1
      return
    }

    endpoint = level.node.endpoint
    try {
      input = buildEndpointInput(endpoint, flags, base)
    } catch (retryError) {
      if (!(retryError instanceof UnknownParameterError)) throw retryError
      reportError(unknownParameterMessage(retryError, refreshStatus))
      process.exitCode = 1
      return
    }
  }
  // The API issues a key only to a token granting sensitive:manage, which the saved login never asks for.
  const client = SENSITIVE_PATHS.has(endpoint.path)
    ? buildTerrosClient({ accessToken: await signInWithSensitiveScopeForEnvironment() })
    : buildTerrosClient()
  let response: unknown
  try {
    if (endpoint.path === '/user/logins' && 'userId' in input && typeof input.userId === 'string') {
      if (!/^U[.:][^@]*$/.test(input.userId)) {
        const { user } = await client.call<{ user: { userId: string } }>('/user/get', { userId: input.userId })
        input = { ...input, userId: user.userId }
      }
    }
    // Read endpoints will soon return upload URLs only when asked, so an upload always asks.
    if (upload && getEndpointInputParameters(endpoint).some(({ name }) => name === INCLUDE_UPLOAD_URLS)) {
      input = { ...input, [INCLUDE_UPLOAD_URLS]: true }
    }
    response =
      endpoint.path === '/apiHistory/start'
        ? await runApiHistoryQuery(client, input)
        : await client.call(endpoint.path, input)
  } catch (error) {
    const hint = await companyScopeHint({ error })
    if (hint === undefined) throw error
    reportError(error instanceof Error ? error.message : error)
    console.error(hint)
    process.exitCode = 1
    return
  }
  if (upload) await uploadToResponse(response, upload)
  console.log(formatOutput(withoutUploadUrls(response)))
  if (upload) console.error(`Uploaded ${upload.path} to ${upload.field}`)
  const hint = await companyScopeHint({ response })
  if (hint !== undefined) console.error(hint)
}

async function signInWithSensitiveScopeForEnvironment(): Promise<string> {
  const refusal = interactiveSignInRefusal(resolveEnvironment())
  if (refusal) throw new Error(refusal)
  return await signInWithSensitiveScope()
}

async function loadCommandLevel(
  words: string[],
  endpoints: Promise<EndpointGroups> = loadEndpoints()
): Promise<CommandLevel> {
  let tree: CommandNode
  try {
    tree = buildCliCommandTree(await endpoints, commandRegistry)
  } catch (error) {
    // A built-in group's own subcommands do not need the API schema, so still list them when it cannot be loaded.
    // A colliding schema is different: listing the group from an empty tree would hide the collision.
    const [name] = words
    if (error instanceof CommandCollisionError || name === undefined || !getCommandGroup(name)) throw error
    reportError(error instanceof Error ? error.message : error)
    tree = { children: new Map() }
  }
  return matchCommand(tree, commandRegistry, words)
}

async function loadCommandLevelWithRefresh(
  words: string[],
  argv: string[] = []
): Promise<{
  level: CommandLevel
  refreshStatus?: SchemaStatus
}> {
  const level = await loadCommandLevel(words)
  if (level.unmatched.length === 0 || isLikelyBuiltinTypo(words, level) || arrayFlagHint(argv, level)) return { level }

  await clearOpenApiCache()
  const refreshed = await loadEndpointsAfterRefresh()
  return {
    level: await loadCommandLevel(words, Promise.resolve(refreshed.endpoints)),
    refreshStatus: refreshed.schemaStatus,
  }
}

function formatLevelHelp(level: CommandLevel): string {
  if (level.words.length === 0) return formatCommandsHelp(level.subcommands)
  if (level.node.endpoint && level.subcommands.length === 0) return formatCommandUsage(level.words.join(' '))
  return formatSubcommandsHelp(level.words.join(' '), level.subcommands)
}

async function showHelp(words: string[], requestedDepth: unknown): Promise<void> {
  const builtinHelp = formatBuiltinHelp(commandRegistry, words)
  if (builtinHelp !== undefined) {
    await checkBuiltinCollisions(loadOfflineEndpoints, commandRegistry, words)
    console.log(builtinHelp)
    return
  }

  const level = await loadCommandLevel(words, loadOfflineEndpoints())
  if (level.unmatched.length > 0) {
    reportError(unknownCommandMessage(words, level))
    console.log(formatLevelHelp(level))
    process.exitCode = 1
    return
  }

  const endpoint = level.node.endpoint
  if (endpoint) {
    const depth = getHelpDepth(requestedDepth)
    const { description, parameters } = withUploadFileHelp(
      endpoint.description,
      getEndpointInputParameters(endpoint, depth).map((parameter) =>
        endpoint.path === '/user/logins' && parameter.name === 'userId'
          ? {
              ...parameter,
              description:
                'User ID, email, account ID, or clientUserId whose sign-in history to return. Defaults to the authenticated user.',
            }
          : parameter
      )
    )
    console.log(
      formatSubcommandParametersHelp(
        level.words.join(' '),
        undefined,
        parameters,
        description,
        true,
        level.subcommands,
        getExampleArguments(endpoint, endpoint.example)
      )
    )
    return
  }

  console.log(formatLevelHelp(level))
}

/**
 * The API documents its upload URLs as response fields to PUT an image to, but the CLI never prints them. Where an
 * endpoint mentions one, help says so and offers `--uploadFile` instead, dropping the request flag for the URL itself.
 */
function withUploadFileHelp(
  description: string | undefined,
  parameters: EndpointParameter[]
): { description?: string; parameters: EndpointParameter[] } {
  const fieldName = (parameter: EndpointParameter): string => parameter.name.split('.').at(-1) ?? ''
  const keys = [...UPLOAD_URL_KEYS]
  const mentionsUploadUrl =
    keys.some((key) => description?.includes(key)) ||
    parameters.some(
      (parameter) => fieldName(parameter) === INCLUDE_UPLOAD_URLS || UPLOAD_URL_KEYS.has(fieldName(parameter))
    )
  if (!mentionsUploadUrl) return { description, parameters }
  const note = `The CLI never prints upload URLs (${keys.join(', ')}); upload an image to one with --uploadFile.`
  return {
    description: description ? `${description}\n\n${note}` : note,
    parameters: [
      ...parameters.filter((parameter) => !UPLOAD_URL_KEYS.has(fieldName(parameter))),
      {
        name: UPLOAD_FILE_FLAG,
        type: '<field>=<path>',
        required: false,
        description: `PUT a PNG, JPEG or WebP image, with its Content-Type, to the presigned URL in the response's <field> (${keys.join(' or ')}), as in --uploadFile uploadAvatarUrl=logo.png. Exits 1 if the response has no such URL.`,
      },
    ],
  }
}

function arrayFlagHint(argv: string[], level: CommandLevel): string | undefined {
  if (!level.node.endpoint) return undefined
  const parameters = getEndpointInputParameters(level.node.endpoint)
  for (const [index, arg] of argv.entries()) {
    if (arg === '--') break
    if (!arg.startsWith('--')) continue
    const [flag, ...assigned] = arg.split('=')
    const name = flag?.slice(2)
    const parameter = parameters.find((parameter) => parameter.name === name)
    if (!parameter) continue
    const array = getArrayParameterSyntax(parameter.type)
    if (!array) continue
    if (parseArgv(argv.slice(0, index))._.length !== level.words.length) continue
    const values = assigned.length > 0 ? [assigned.join('=')] : []
    for (const value of argv.slice(index + 1)) {
      if (value.startsWith('-') && !NEGATIVE_NUMBER.test(value)) break
      values.push(value)
    }
    if (values.length < 2) continue
    if (array.structured) {
      let items: unknown[]
      try {
        items = values.map((value) => JSON.parse(value))
      } catch {
        return `${flag} takes a shell-quoted JSON array; each item must be valid JSON`
      }
      return `${flag} takes a JSON array; pass ${flag} ${quoteShellArgument(JSON.stringify(items))}`
    }
    if (values[0]?.trim().startsWith('[')) continue
    const hint = `${flag} takes comma-separated values`
    const allowed = array.allowed
    if (!allowed) return `${hint}; pass ${formatFlagArgument(flag!, values.join(','))}`
    const entries = values.flatMap((value) => value.split(','))
    const invalid = entries.filter((value) => !allowed.some((literal) => matchesStringLiteral(value, literal)))
    const valid = entries.filter((value) => !invalid.includes(value))
    const suggestion =
      valid.length > 0 ? `; pass ${formatFlagArgument(flag!, valid.map(preserveNumericString).join(','))}` : ''
    return `${hint}${suggestion}. Allowed values: ${allowed.join(', ')}${invalid.length > 0 ? `. Invalid values: ${invalid.join(', ')}` : ''}`
  }
  return undefined
}

function unknownCommandMessage(words: string[], level: CommandLevel, refreshStatus?: SchemaStatus): string {
  if (isLikelyBuiltinTypo(words, level)) {
    return `Unknown built-in command: terros ${words.join(' ')}. Check the built-in command names above.`
  }
  if (refreshStatus === 'available') {
    return `Unknown command: terros ${words.join(' ')}. The refreshed API schema does not include it; check whether the endpoint is deployed and available to your account. For a manual schema retry, run \`terros api refresh\`; to call an endpoint the schema does not list, run \`terros api call /${words.join('/')}\`.`
  }
  return `Unknown command: terros ${words.join(' ')}. The API schema could not be refreshed; retry with \`terros api refresh\` or update the CLI with \`npm install -g @terros-inc/cli\`.`
}

function unknownParameterMessage(error: unknown, refreshStatus?: SchemaStatus): string {
  const message = error instanceof Error ? error.message : String(error)
  if (refreshStatus === 'available') {
    return `${message}. The refreshed API schema still does not include this parameter; check whether it is supported for your account. For a manual schema retry, run \`terros api refresh\`.`
  }
  return `${message}. The API schema could not be refreshed; retry with \`terros api refresh\` or update the CLI with \`npm install -g @terros-inc/cli\`.`
}

function isLikelyBuiltinTypo(words: string[], level: CommandLevel): boolean {
  if (level.words.length > 1) return false
  const group = getCommandGroup(words[0] ?? '')
  const candidate = words[1]
  if (!group || !candidate || Object.hasOwn(group.subcommands, candidate)) return false
  return Object.keys(group.subcommands).some((name) => isOneEditAway(candidate, name))
}

function isOneEditAway(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let left = 0
  let right = 0
  let edits = 0
  while (left < a.length && right < b.length) {
    if (a[left] === b[right]) {
      left++
      right++
    } else {
      if (++edits > 1) return false
      if (a.length > b.length) left++
      else if (b.length > a.length) right++
      else {
        left++
        right++
      }
    }
  }
  return edits + Number(left < a.length || right < b.length) <= 1
}

function getHelpDepth(requestedDepth: unknown): number {
  if (requestedDepth === undefined) return DEFAULT_TYPE_DEPTH
  if (typeof requestedDepth !== 'number' || !Number.isInteger(requestedDepth) || requestedDepth < 0) {
    throw new Error('--depth must be a non-negative integer')
  }

  return requestedDepth
}
