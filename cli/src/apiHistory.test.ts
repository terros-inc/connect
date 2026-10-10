import { runApiHistoryQuery } from './apiHistory'

it('polls until the query succeeds', async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce({ type: 'success', queryId: 'query-1' })
    .mockResolvedValueOnce({ type: 'success', state: 'running' })
    .mockResolvedValueOnce({ type: 'success', state: 'succeeded', requests: [] })
  vi.useFakeTimers()
  const result = runApiHistoryQuery({ call }, { companyId: 'C:example' })
  await vi.runAllTimersAsync()
  await expect(result).resolves.toMatchObject({ state: 'succeeded', requests: [] })
  expect(call).toHaveBeenLastCalledWith('apiHistory/status', { queryId: 'query-1' })
  vi.useRealTimers()
})

it('reports Athena failure', async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce({ queryId: 'query-1' })
    .mockResolvedValueOnce({ state: 'failed', error: 'scan failed' })
  await expect(runApiHistoryQuery({ call }, { companyId: 'C:example' })).rejects.toThrow('scan failed')
})

it('includes the query ID when polling times out', async () => {
  vi.useFakeTimers()
  const call = vi
    .fn()
    .mockResolvedValueOnce({ type: 'success', queryId: 'query-resumable' })
    .mockResolvedValue({ type: 'success', state: 'running' })
  const result = runApiHistoryQuery({ call }, { companyId: 'C:example' })
  const expectation = expect(result).rejects.toThrow('query-resumable')
  await vi.advanceTimersByTimeAsync(120_000)
  await expectation
  vi.useRealTimers()
})

it('requires a company ID before starting a query', async () => {
  const call = vi.fn()
  await expect(runApiHistoryQuery({ call }, {})).rejects.toThrow('--companyId')
  expect(call).not.toHaveBeenCalled()
})

it('surfaces a clipped time window from the start response', async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce({
      type: 'success',
      queryId: 'query-1',
      effectiveSince: '2026-10-03T00:00:00.000Z',
      sinceClipped: true,
    })
    .mockResolvedValueOnce({ type: 'success', state: 'succeeded', requests: [] })
  await expect(runApiHistoryQuery({ call }, { companyId: 'C:example' })).resolves.toMatchObject({
    effectiveSince: '2026-10-03T00:00:00.000Z',
    sinceClipped: true,
  })
})
