const APPTOTO_API = 'https://api.apptoto.com'

export type Secrets = {
  username: string
  apiKey: string
}

export type ApptotoEvent = {
  id: number
  calendar_id: number | string
  external_id?: string | null
  start_time?: string
  end_time?: string
  is_deleted?: boolean
  participants?: { id: number; state?: string }[] | null
}

class ApptotoApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

function authorization(secrets: Secrets): string {
  if (!secrets.username || !secrets.apiKey) throw new Error('Apptoto username and apiKey are required')
  return `Basic ${Buffer.from(`${secrets.username}:${secrets.apiKey}`).toString('base64')}`
}

export async function apptotoRequest<T>(
  secrets: Secrets,
  path: string,
  init: RequestInit = {}
): Promise<T | undefined> {
  const response = await fetch(`${APPTOTO_API}${path}`, {
    ...init,
    headers: {
      Authorization: authorization(secrets),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after')
    throw new ApptotoApiError(
      `Apptoto rate limit exceeded${retryAfter ? `; retry after ${retryAfter}` : ''}`,
      response.status
    )
  }
  if (!response.ok) {
    throw new ApptotoApiError(`Apptoto ${init.method ?? 'GET'} ${path} failed with ${response.status}`, response.status)
  }
  if (response.status === 204) return undefined
  const body = await response.text()
  return body ? (JSON.parse(body) as T) : undefined
}

export async function findEvent(
  secrets: Secrets,
  query: { external_id: string } | { id: number }
): Promise<ApptotoEvent | undefined> {
  try {
    const result = await apptotoRequest<ApptotoEvent | { event: ApptotoEvent }>(
      secrets,
      `/v1/event?${new URLSearchParams('id' in query ? { id: String(query.id) } : query)}`
    )
    if (!result) return undefined
    return 'event' in result ? result.event : result
  } catch (error) {
    if (isNotFound(error)) return undefined
    throw error
  }
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApptotoApiError && error.status === 404
}

export function isOn(value: boolean | string | undefined): boolean {
  return value === true || value === 'true'
}
