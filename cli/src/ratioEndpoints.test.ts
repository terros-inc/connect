import { main } from './main'
import { loadEndpoints } from './loadEndpoints'
import { ratioEndpoints } from './crud/ratio'
import { buildTerrosClient } from './api/query'

vi.mock('./loadEndpoints', () => ({ loadEndpoints: vi.fn() }))
vi.mock('./api/query', () => ({ buildTerrosClient: vi.fn() }))
vi.mock('./mcp', () => ({ startMcpServer: vi.fn() }))
vi.mock('./commands/connect', () => ({
  connectCommands: { publish: { description: 'Publish an integration', run: vi.fn() } },
}))

const call = vi.fn()
const customRatio = {
  scopeId: 'C.example',
  name: 'Close Rate',
  type: 'percentage',
  numerator: 'setter|S.closed|count',
  denominator: 'contact.pitches',
}
const advancedCustomStat = {
  scopeId: 'C.example',
  name: 'Revenue per Pitch',
  type: 'formula',
  formula: '$Revenue / $Pitch',
  scopes: {
    $Revenue: 'cf|account|sum|CF.revenue|createdDate',
    $Pitch: 'contact.pitches',
  },
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(loadEndpoints).mockResolvedValue({ ratio: ratioEndpoints })
  vi.mocked(buildTerrosClient).mockReturnValue({ call } as unknown as ReturnType<typeof buildTerrosClient>)
  call.mockResolvedValue({ type: 'success' })
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

it.each([
  ['custom ratio', customRatio],
  ['advanced custom stat', advancedCustomStat],
])('adds a %s with the API ratio contract', async (_kind, ratio) => {
  await main(['ratio', 'add', '--ratio', JSON.stringify(ratio)])

  expect(call).toHaveBeenCalledWith('/ratio/add', { ratio })
})

it.each([
  ['custom ratio', customRatio],
  ['advanced custom stat', advancedCustomStat],
])('updates a %s with its identifiers and complete definition', async (_kind, ratio) => {
  const saved = { ...ratio, ratioId: 'Ratio.example' }
  await main(['ratio', 'update', '--ratio', JSON.stringify(saved)])

  expect(call).toHaveBeenCalledWith('/ratio/update', { ratio: saved })
})

it.each([
  ['custom ratio', 'Ratio.custom'],
  ['advanced custom stat', 'Ratio.advanced'],
])('removes a %s by its shared ratio identifier', async (_kind, ratioId) => {
  await main(['ratio', 'remove', '--ratioId', ratioId])

  expect(call).toHaveBeenCalledWith('/ratio/remove', { ratioId })
})

it('rejects a missing custom-stat definition before calling the API', async () => {
  await expect(main(['ratio', 'add'])).rejects.toThrow('Missing required parameter(s): --ratio')
  expect(call).not.toHaveBeenCalled()
})
