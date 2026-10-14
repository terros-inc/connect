import { InMemoryTransport, type JSONRPCMessage } from '@modelcontextprotocol/server'
import {
  createMcpServer,
  CALL_TOOL,
  DESCRIBE_TOOL,
  SEARCH_TOOL,
  type EndpointGroups,
  type ToolMode,
} from '../src/index.ts'
import { MOCK_RESPONSES, type EvalStep, type EvalTask } from './tasks.ts'

export type EvalConfig = {
  label: string
  mode: ToolMode
  toolsets?: string[]
}

export type TaskResult = {
  task: string
  config: string
  success: boolean
  failure?: string
  toolCalls: number
  /** Search calls that did not list the needed operation. */
  missedSearches: number
  toolDefinitionTokens: number
  inputTokens: number
  milliseconds: number
}

type ApiCall = { route: string; input: object }
type Request = (method: string, params?: Record<string, unknown>) => Promise<any>
type Transcript = { toolCalls: number; missedSearches: number; turnTokens: number[]; lastText: string }

/** Rough token estimate (4 characters per token). Used only to compare modes with each other. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Run one task against an in-memory MCP server backed by a mocked API. */
export async function runTask(endpoints: EndpointGroups, config: EvalConfig, task: EvalTask): Promise<TaskResult> {
  const started = performance.now()
  const apiCalls: ApiCall[] = []
  const client = {
    call: async <Success>(route: string, input: object): Promise<Success> => {
      apiCalls.push({ route, input })
      return (MOCK_RESPONSES.get(route) ?? { type: 'success' }) as Success
    },
  }
  const server = createMcpServer({ endpoints, client, version: 'eval', mode: config.mode, toolsets: config.toolsets })
  const { request, close } = await connect(server)
  const listed = await request('tools/list')
  const toolDefinitions = JSON.stringify(listed.result.tools)
  const names = new Set<string>(listed.result.tools.map((tool: { name: string }) => tool.name))
  const transcript: Transcript = {
    toolCalls: 0,
    missedSearches: 0,
    turnTokens: [estimateTokens(task.prompt)],
    lastText: '',
  }

  let failure: string | undefined
  for (const step of task.steps) {
    failure =
      config.mode === 'meta'
        ? await runMetaStep(request, step, transcript)
        : await runEndpointStep(request, names, step, transcript)
    if (failure) break
  }
  await close()

  failure ??= checkApiCalls(task, apiCalls)
  if (!failure && !transcript.lastText.includes(task.expect)) failure = `final result is missing "${task.expect}"`
  const definitionTokens = estimateTokens(toolDefinitions)
  return {
    task: task.id,
    config: config.label,
    success: !failure,
    failure,
    toolCalls: transcript.toolCalls,
    missedSearches: transcript.missedSearches,
    toolDefinitionTokens: definitionTokens,
    inputTokens: sumInputTokens(definitionTokens, transcript.turnTokens),
    milliseconds: performance.now() - started,
  }
}

/**
 * The client resends the tool definitions and the whole transcript on every model turn, and there is one turn per
 * tool call plus the final answer. No prompt caching is assumed.
 */
function sumInputTokens(definitionTokens: number, turnTokens: number[]): number {
  let transcript = 0
  let total = 0
  for (const tokens of turnTokens) {
    transcript += tokens
    total += definitionTokens + transcript
  }
  return total
}

async function runEndpointStep(
  request: Request,
  names: Set<string>,
  step: EvalStep,
  transcript: Transcript
): Promise<string | undefined> {
  if (!names.has(step.tool)) return `${step.tool} is not in the tool list`
  return callTool(request, transcript, step.tool, step.args)
}

async function runMetaStep(request: Request, step: EvalStep, transcript: Transcript): Promise<string | undefined> {
  let found = false
  for (const query of step.queries) {
    const failure = await callTool(request, transcript, SEARCH_TOOL, { query })
    if (failure) return failure
    found = transcript.lastText.split('\n').some((line) => line.startsWith(`${step.tool} `))
    if (found) break
    transcript.missedSearches += 1
  }
  if (!found) return `search never listed ${step.tool} (queries: ${step.queries.join(' | ')})`
  const described = await callTool(request, transcript, DESCRIBE_TOOL, { name: step.tool })
  if (described) return described
  return callTool(request, transcript, CALL_TOOL, { name: step.tool, args: step.args })
}

async function callTool(
  request: Request,
  transcript: Transcript,
  name: string,
  args: object
): Promise<string | undefined> {
  const response = await request('tools/call', { name, arguments: args })
  const text: string = response.result?.content?.[0]?.text ?? JSON.stringify(response.error)
  transcript.toolCalls += 1
  transcript.turnTokens.push(estimateTokens(JSON.stringify({ name, arguments: args })) + estimateTokens(text))
  transcript.lastText = text
  if (response.error || response.result?.isError) return `${name} failed: ${text}`
  return undefined
}

function checkApiCalls(task: EvalTask, apiCalls: ApiCall[]): string | undefined {
  const expected = task.steps.map((step) => ({ route: step.tool.replaceAll('_', '/'), input: step.args }))
  if (JSON.stringify(apiCalls) !== JSON.stringify(expected)) {
    return `API calls ${JSON.stringify(apiCalls.map((call) => call.route))} differ from the expected ${JSON.stringify(expected.map((call) => call.route))}`
  }
  return undefined
}

async function connect(
  server: ReturnType<typeof createMcpServer>
): Promise<{ request: Request; close: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const pending = new Map<number, (message: any) => void>()
  clientTransport.onmessage = (message: JSONRPCMessage) => {
    if ('id' in message && typeof message.id === 'number') {
      pending.get(message.id)?.(message)
      pending.delete(message.id)
    }
  }
  await server.connect(serverTransport)
  await clientTransport.start()
  let nextId = 0
  const request: Request = (method, params = {}) => {
    const id = ++nextId
    return new Promise((resolve) => {
      pending.set(id, resolve)
      void clientTransport.send({ jsonrpc: '2.0', id, method, params })
    })
  }
  await request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'terros-eval', version: '1.0.0' },
  })
  await clientTransport.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  return { request, close: () => server.close() }
}
