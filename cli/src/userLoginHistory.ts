export type UserLoginHistoryItem = {
  timestamp: number
  type: 'success' | 'failed'
  description?: string
}

type UserLoginsSuccess = {
  type: 'success'
  history: UserLoginHistoryItem[]
  page?: number
  hasMore?: boolean
}

type ApiCaller = {
  call<T>(endpoint: string, input: object): Promise<T>
}

/** Fetch every page from the API's user-scoped login query. */
export async function getUserLoginHistory(client: ApiCaller, userId: string): Promise<UserLoginHistoryItem[]> {
  const history: UserLoginHistoryItem[] = []
  let page = 0

  while (true) {
    const response = await client.call<UserLoginsSuccess>('user/logins', page === 0 ? { userId } : { userId, page })
    history.push(...response.history)
    if (!response.hasMore) return history
    page = (response.page ?? page) + 1
  }
}
