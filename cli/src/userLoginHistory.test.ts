import { getUserLoginHistory } from './userLoginHistory'

it('retrieves every user-scoped page without changing recorded outcomes or details', async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce({
      type: 'success',
      history: [
        { timestamp: 1_800_000_000_000, type: 'failed', description: 'Wrong username or password.' },
        { timestamp: 1_799_999_000_000, type: 'success' },
      ],
      page: 0,
      hasMore: true,
    })
    .mockResolvedValueOnce({
      type: 'success',
      history: [{ timestamp: 1_799_998_000_000, type: 'failed', description: 'Invalid request.' }],
      page: 1,
      hasMore: false,
    })

  await expect(getUserLoginHistory({ call }, 'U.example-user')).resolves.toEqual([
    { timestamp: 1_800_000_000_000, type: 'failed', description: 'Wrong username or password.' },
    { timestamp: 1_799_999_000_000, type: 'success' },
    { timestamp: 1_799_998_000_000, type: 'failed', description: 'Invalid request.' },
  ])
  expect(call).toHaveBeenNthCalledWith(1, 'user/logins', { userId: 'U.example-user' })
  expect(call).toHaveBeenNthCalledWith(2, 'user/logins', { userId: 'U.example-user', page: 1 })
})
