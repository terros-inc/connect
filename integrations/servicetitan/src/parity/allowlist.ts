import type { ReplayResult, StRequest, TerrosWrite } from './types.ts'
import { sameRequest, stableJson } from './normalize.ts'

// Placeholder tenant from the fixtures. The legacy cancel reason is also a placeholder (9001) in the
// fixtures and goldens, so A4 does not show up as a body diff.
const TENANT_ID = '1000'

export type AllowId = 'A1' | 'A2' | 'A5' | 'A8' | 'A9' | 'A10' | 'A11' | 'A13' | 'A14' | 'A15'

export type AllowlistEntry = {
  id: AllowId
  difference: string
  scenarios: number[]
  apply: (actual: ReplayResult, golden: ReplayResult, scenario: number) => boolean
}

/**
 * Differences the replay is allowed to ignore. Each entry is one item from the parity plan's A1–A17
 * list, the scenarios where that difference shows up, and a check that accepts only that shape.
 *
 * An entry that does not match every scenario it names fails the suite, so a fixed difference cannot
 * stay on the list. A diff this list does not accept fails the scenario.
 *
 * These items do not produce a replay diff, so they are not entries:
 * - A3 reassign order. The ServiceTitan calls stay create-then-cancel. The extra sourceId write is A1.
 * - A4 cancel reason. Both sides use the placeholder reason id, and the memo is the same text.
 * - A6 customer search error. The fixture fails the search once with HTTP 500. Connect retries the read,
 *   the next attempt succeeds, and the create matches legacy. The difference is the retry count (A14),
 *   not a thrown search.
 * - A7 technician search error. The same single HTTP 500 is retried and then Connect creates, which is
 *   not "Connect throws" and not a retry count on the same requests. Scenario 21 is a known failure.
 * - A12 undefined outcome on create. Scenario 15 is a linked no-op; neither side sends an outcome field.
 * - A16 response validation. This fake returns the fields Connect validates.
 * - A17 token cache key. Token calls are dropped before the diff.
 */
export const ALLOWLIST: AllowlistEntry[] = [
  {
    id: 'A1',
    difference:
      'Connect writes tenantId:jobId on the account and also writes event.sourceId. Legacy writes the bare job id and does not touch sourceId.',
    scenarios: [1, 2, 3, 4, 5, 6, 7, 10, 18, 19, 22, 23, 30],
    apply: applyLinkFormat,
  },
  {
    id: 'A2',
    difference:
      'The first Connect run on a legacy link writes the prefixed account field and event.sourceId. Legacy writes nothing. Scenario 27 follows a prefixed sourceId instead of creating; the seed has no such job, so the lookup 404s.',
    scenarios: [11, 12, 13, 14, 15, 16, 17, 20, 27, 28],
    apply: applyLinkBackfill,
  },
  {
    id: 'A5',
    difference: 'Connect reschedules when the appointment end changes. Legacy compares the start only.',
    scenarios: [13],
    apply: applyReschedule,
  },
  {
    id: 'A8',
    difference:
      'An invalid stored link makes Connect throw before any ServiceTitan call. Legacy warns and creates a new job.',
    scenarios: [26],
    apply: applyInvalidLink,
  },
  {
    id: 'A9',
    difference:
      'A missing resident makes Connect stop after the technician search. Legacy still searches for a customer, then skips the create.',
    scenarios: [8],
    apply: applyMissingResident,
  },
  {
    id: 'A10',
    difference:
      'Legacy reads the canonical location and throws when latlng is missing. Connect reads account.location, which still has coordinates, and creates.',
    scenarios: [9],
    apply: applyMissingLatLng,
  },
  {
    id: 'A11',
    difference:
      'Connect sends account.location. Legacy sends the canonical location. Only street, city, state, zip, and coordinates may differ.',
    scenarios: [10],
    apply: applyLocationSource,
  },
  {
    id: 'A13',
    difference:
      'Connect rejects a missing jobTypeId while parsing config. Legacy skips that payload and makes no ServiceTitan call.',
    scenarios: [24],
    apply: applyConfigError,
  },
  {
    id: 'A14',
    difference:
      'Connect retries a retryable read or update. Legacy records a single failed call except for location reads. Compared after retries of the same call are collapsed.',
    scenarios: [4, 19, 20],
    apply: applyRetryCount,
  },
  {
    id: 'A15',
    difference:
      'A customer create failure throws PermanentError from sync. Legacy returns, and the golden records that as skipped. The ServiceTitan calls match.',
    scenarios: [29],
    apply: applyFailureSurfacing,
  },
]

const ADDRESS_KEYS = new Set(['street', 'city', 'state', 'zip', 'latitude', 'longitude'])

export function explain(
  scenario: number,
  actual: ReplayResult,
  golden: ReplayResult
): { matched: AllowId[]; remaining: ReplayResult } {
  const remaining = structuredClone(actual)
  const matched: AllowId[] = []
  for (const entry of ALLOWLIST) {
    if (!entry.scenarios.includes(scenario)) continue
    if (entry.apply(remaining, golden, scenario)) matched.push(entry.id)
  }
  return { matched, remaining }
}

export function sameResult(left: ReplayResult, right: ReplayResult): boolean {
  return stableJson(project(left)) === stableJson(project(right))
}

export function diffResult(expected: ReplayResult, actual: ReplayResult): string[] {
  return diffValues(project(expected), project(actual), '')
}

export function sequence(result: ReplayResult): string {
  const requests = result.stRequests
    .map((request) => {
      const path = request.path.split('/').slice(5).join('/')
      const retries = request.retries ? ` x${request.retries + 1}` : ''
      return `${request.method} ${path}${retries}`
    })
    .join(' | ')
  const writes = result.terrosWrites.map((write) => `${write.op}=${write.value}`).join(',')
  return `${result.outcome} writes[${writes}] ${requests}`
}

function project(result: ReplayResult): ReplayResult {
  return { outcome: result.outcome, stRequests: result.stRequests, terrosWrites: result.terrosWrites }
}

function applyLinkFormat(actual: ReplayResult, golden: ReplayResult): boolean {
  let matched = false
  for (const write of actual.terrosWrites) {
    if (write.op !== 'updateAccountCustomField') continue
    const expected = golden.terrosWrites.find(
      (item) =>
        item.op === 'updateAccountCustomField' && item.accountId === write.accountId && item.fieldId === write.fieldId
    )
    if (!expected) continue
    if (write.value === `${TENANT_ID}:${expected.value}`) {
      write.value = expected.value
      matched = true
    }
  }
  const kept: TerrosWrite[] = []
  for (const write of actual.terrosWrites) {
    if (write.op !== 'writeEventSourceId') {
      kept.push(write)
      continue
    }
    const accountWrite = actual.terrosWrites.find((item) => item.op === 'updateAccountCustomField')
    const bare = accountWrite?.value
    const prefixed = bare === undefined ? undefined : `${TENANT_ID}:${bare}`
    const goldenHasSource = golden.terrosWrites.some((item) => item.op === 'writeEventSourceId')
    if (!goldenHasSource && (write.value === bare || write.value === prefixed)) {
      matched = true
      continue
    }
    kept.push(write)
  }
  actual.terrosWrites = kept
  return matched
}

function applyLinkBackfill(actual: ReplayResult, golden: ReplayResult, scenario: number): boolean {
  if (scenario === 27) return explainPrefixedSourceId(actual, golden)
  if (golden.terrosWrites.length !== 0 || actual.terrosWrites.length === 0) return false
  if (!actual.terrosWrites.every(isLinkWrite)) return false
  actual.terrosWrites = []
  if (actual.outcome === 'processed' && golden.outcome === 'noop') actual.outcome = 'noop'
  return true
}

function explainPrefixedSourceId(actual: ReplayResult, golden: ReplayResult): boolean {
  if (actual.outcome !== 'threw' || actual.terrosWrites.length !== 0) return false
  if (golden.outcome !== 'processed' || actual.stRequests.length !== 2) return false
  const technician = actual.stRequests[0]
  const job = actual.stRequests[1]
  const goldenTechnician = golden.stRequests[0]
  if (!technician || !job || !goldenTechnician) return false
  if (!sameRequest(technician, goldenTechnician) || (technician.retries ?? 0) !== (goldenTechnician.retries ?? 0))
    return false
  if (job.method !== 'GET' || !/\/jobs\/555$/.test(job.path)) return false
  if (!golden.stRequests.some((request) => request.method === 'POST' && request.path.endsWith('/jobs'))) return false
  actual.stRequests = structuredClone(golden.stRequests)
  actual.terrosWrites = structuredClone(golden.terrosWrites)
  actual.outcome = golden.outcome
  return true
}

function isLinkWrite(write: TerrosWrite): boolean {
  return (
    write.value.startsWith(`${TENANT_ID}:`) &&
    (write.op === 'updateAccountCustomField' || write.op === 'writeEventSourceId')
  )
}

function applyReschedule(actual: ReplayResult, golden: ReplayResult): boolean {
  const reschedule = (request: StRequest): boolean => request.method === 'PATCH' && request.path.endsWith('/reschedule')
  if (golden.stRequests.some(reschedule)) return false
  if (actual.stRequests.filter(reschedule).length !== 1) return false
  actual.stRequests = actual.stRequests.filter((request) => !reschedule(request))
  if (actual.outcome === 'processed' && golden.outcome === 'noop') actual.outcome = 'noop'
  return true
}

function applyInvalidLink(actual: ReplayResult, golden: ReplayResult): boolean {
  if (actual.outcome !== 'threw' || actual.stRequests.length !== 0 || actual.terrosWrites.length !== 0) return false
  if (golden.outcome !== 'processed') return false
  if (!golden.stRequests.some((request) => request.method === 'POST' && request.path.endsWith('/jobs'))) return false
  actual.stRequests = structuredClone(golden.stRequests)
  actual.terrosWrites = structuredClone(golden.terrosWrites)
  actual.outcome = golden.outcome
  return true
}

function applyMissingResident(actual: ReplayResult, golden: ReplayResult): boolean {
  if (actual.outcome !== 'skipped' || golden.outcome !== 'skipped') return false
  if (actual.terrosWrites.length !== 0 || golden.terrosWrites.length !== 0) return false
  if (actual.stRequests.length === 0 || actual.stRequests.length >= golden.stRequests.length) return false
  if (!isPrefix(actual.stRequests, golden.stRequests)) return false
  actual.stRequests = structuredClone(golden.stRequests)
  return true
}

function applyMissingLatLng(actual: ReplayResult, golden: ReplayResult): boolean {
  if (golden.outcome !== 'threw' || actual.outcome !== 'processed') return false
  if (golden.terrosWrites.length !== 0 || golden.stRequests.length === 0) return false
  if (actual.stRequests.length <= golden.stRequests.length) return false
  if (!isPrefix(golden.stRequests, actual.stRequests)) return false
  if (!actual.terrosWrites.some(isLinkWrite)) return false
  const tail = actual.stRequests.slice(golden.stRequests.length)
  const customer = tail.find((request) => request.method === 'POST' && request.path.endsWith('/customers'))
  const job = tail.find((request) => request.method === 'POST' && request.path.endsWith('/jobs'))
  const address = isRecord(customer?.body) ? customer.body.address : undefined
  if (!isRecord(address) || typeof address.latitude !== 'number' || typeof address.longitude !== 'number') return false
  if (!isRecord(job?.body) || job.body.priority !== 'Normal') return false
  actual.stRequests = structuredClone(golden.stRequests)
  actual.terrosWrites = []
  actual.outcome = golden.outcome
  return true
}

function applyLocationSource(actual: ReplayResult, golden: ReplayResult): boolean {
  if (actual.stRequests.length !== golden.stRequests.length) return false
  const copy = structuredClone(actual.stRequests)
  let matched = false
  for (let index = 0; index < copy.length; index++) {
    const left = copy[index]
    const right = golden.stRequests[index]
    if (!left || !right || left.method !== right.method || left.path !== right.path) return false
    if (alignAddress(left, right)) matched = true
  }
  if (!matched) return false
  actual.stRequests = copy
  return true
}

function applyConfigError(actual: ReplayResult, golden: ReplayResult): boolean {
  if (actual.outcome !== 'threw' || golden.outcome !== 'skipped') return false
  if (actual.stRequests.length !== 0 || golden.stRequests.length !== 0) return false
  if (actual.terrosWrites.length !== 0 || golden.terrosWrites.length !== 0) return false
  actual.outcome = 'skipped'
  return true
}

function applyRetryCount(actual: ReplayResult, golden: ReplayResult): boolean {
  if (actual.stRequests.length !== golden.stRequests.length) return false
  let matched = false
  for (let index = 0; index < actual.stRequests.length; index++) {
    const left = actual.stRequests[index]
    const right = golden.stRequests[index]
    if (!left || !right || !sameRequest(left, right)) continue
    if ((left.retries ?? 0) === (right.retries ?? 0)) continue
    if (right.retries === undefined) delete left.retries
    else left.retries = right.retries
    matched = true
  }
  return matched
}

function applyFailureSurfacing(actual: ReplayResult, golden: ReplayResult): boolean {
  if (actual.outcome !== 'threw' || golden.outcome !== 'skipped') return false
  if (!sameRequests(actual.stRequests, golden.stRequests)) return false
  if (stableJson(actual.terrosWrites) !== stableJson(golden.terrosWrites)) return false
  const last = golden.stRequests.at(-1)
  if (last?.method !== 'POST' || !last.path.endsWith('/customers')) return false
  actual.outcome = golden.outcome
  return true
}

function alignAddress(actual: unknown, golden: unknown): boolean {
  if (Array.isArray(actual) && Array.isArray(golden)) {
    if (actual.length !== golden.length) return false
    let matched = false
    for (let index = 0; index < actual.length; index++) {
      if (alignAddress(actual[index], golden[index])) matched = true
    }
    return matched
  }
  if (!isRecord(actual) || !isRecord(golden)) return false
  let matched = false
  const keys = new Set([...Object.keys(actual), ...Object.keys(golden)])
  for (const key of keys) {
    if (ADDRESS_KEYS.has(key)) {
      if (stableJson(actual[key]) === stableJson(golden[key])) continue
      if (!(key in golden)) delete actual[key]
      else actual[key] = structuredClone(golden[key])
      matched = true
      continue
    }
    if (key in actual && key in golden && alignAddress(actual[key], golden[key])) matched = true
  }
  return matched
}

function isPrefix(prefix: StRequest[], full: StRequest[]): boolean {
  if (prefix.length > full.length) return false
  return prefix.every((request, index) => {
    const other = full[index]
    return other !== undefined && sameRequest(request, other) && (request.retries ?? 0) === (other.retries ?? 0)
  })
}

function sameRequests(left: StRequest[], right: StRequest[]): boolean {
  return left.length === right.length && isPrefix(left, right)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function diffValues(expected: unknown, actual: unknown, path: string): string[] {
  if (stableJson(expected) === stableJson(actual)) return []
  if (Array.isArray(expected) || Array.isArray(actual)) {
    const left = Array.isArray(expected) ? expected : []
    const right = Array.isArray(actual) ? actual : []
    const lines: string[] = []
    const count = Math.max(left.length, right.length)
    for (let index = 0; index < count; index++)
      lines.push(...diffValues(left[index], right[index], `${path}[${index}]`))
    return lines
  }
  if (isRecord(expected) && isRecord(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort((left, right) =>
      left.localeCompare(right)
    )
    return keys.flatMap((key) => diffValues(expected[key], actual[key], `${path}.${key}`))
  }
  return [`${path || '(root)'}: ${stableJson(actual)} !== ${stableJson(expected)}`]
}
