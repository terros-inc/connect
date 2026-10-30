import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, readdirSync } from 'node:fs'
import type { AccountId, CalendarEventId } from '@terros-inc/sdk'
import { sync, type Account, type CalendarEventWebhook, type EventData, type Outcome, type Ports } from '../sync.ts'
import { ServiceTitanClient } from '../servicetitan.ts'
import { parseConfig, parseSecrets, type Config } from '../config.ts'
import type {
  FixtureAddress,
  FixtureUser,
  GoldenFile,
  ParityFixture,
  ParityOutcome,
  ReplayResult,
  TerrosWrite,
} from './types.ts'
import { normalizeCalls, normalizeWrites } from './normalize.ts'
import { ParityFake } from './fakeServer.ts'

const parityDir = join(dirname(fileURLToPath(import.meta.url)), '../../test/parity')

export function loadFixtures(): ParityFixture[] {
  const directory = join(parityDir, 'fixtures')
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(directory, name), 'utf8')) as ParityFixture)
}

export function loadGolden(id: number): GoldenFile {
  const name = `scenario-${String(id).padStart(2, '0')}.json`
  return JSON.parse(readFileSync(join(parityDir, 'goldens', name), 'utf8')) as GoldenFile
}

// Retry delays are real setTimeouts. The abort timer is an arrow function; the retry timer's callback is the
// native Promise resolver. Skipping only the native one keeps the run inside the budget without aborting the request.
export function installFastRetries(): () => void {
  const original = global.setTimeout
  const wrapped = (fn: unknown, delay?: number, ...args: unknown[]): ReturnType<typeof setTimeout> => {
    if (typeof fn === 'function' && Function.prototype.toString.call(fn).includes('[native code]')) {
      ;(fn as (...inner: unknown[]) => void)(...args)
      return 0 as unknown as ReturnType<typeof setTimeout>
    }
    return original(fn as never, delay as never, ...(args as []))
  }
  global.setTimeout = wrapped as unknown as typeof setTimeout
  return () => {
    global.setTimeout = original
  }
}

export async function replay(fixture: ParityFixture): Promise<ReplayResult> {
  const writes: TerrosWrite[] = []
  const fake = new ParityFake(fixture)
  let outcome: ParityOutcome = 'threw'
  try {
    if (!fixture.credentials) throw new Error('missing credentials')
    const config = parseConfig(fixture.connectConfig)
    const secrets = parseSecrets({
      ...fixture.credentials,
      clientId: `${fixture.credentials.clientId}-scenario-${fixture.id}`,
    })
    const api = new ServiceTitanClient(secrets, fake.fetch)
    const result = await sync(toPayload(fixture), config, api, ports(fixture, config, writes))
    outcome = toOutcome(result)
  } catch {
    outcome = 'threw'
  }
  return {
    stRequests: normalizeCalls(fake.calls, fake.aliases),
    terrosWrites: normalizeWrites(writes, fake.aliases),
    outcome,
  }
}

function toOutcome(result: Outcome): ParityOutcome {
  if (result.kind === 'skipped') return 'skipped'
  if (result.kind === 'unchanged') return 'noop'
  return 'processed'
}

function ports(fixture: ParityFixture, config: Config, writes: TerrosWrite[]): Ports {
  const account = toAccount(fixture)
  return {
    readAccount: async () => structuredClone(account),
    writeAccountCustomField: async (accountId, fields) => {
      const before = account.customFields ?? {}
      const previousFields: Record<string, unknown> = before
      const nextFields: Record<string, unknown> = fields
      const keys = new Set([...Object.keys(previousFields), ...Object.keys(nextFields)])
      for (const fieldId of keys) {
        const previous = previousFields[fieldId]
        const next = nextFields[fieldId]
        if (previous === next) continue
        writes.push({
          op: 'updateAccountCustomField',
          accountId,
          fieldId,
          value: next === undefined ? '' : String(next),
        })
      }
    },
    writeEventSourceId: async (eventId, value) => {
      writes.push({ op: 'writeEventSourceId', eventId, value })
    },
    log: () => undefined,
  }
}

function toAccount(fixture: ParityFixture): Account {
  const account = fixture.account
  if (!account) {
    return { accountId: 'Account.example' as AccountId }
  }
  const resident = account.resident ?? undefined
  const location = account.location ? toLocation(account.location) : undefined
  return {
    accountId: account.accountId as AccountId,
    accountSource: account.accountSource,
    ...(account.customFields ? { customFields: account.customFields } : {}),
    ...(resident ? { resident } : {}),
    ...(location ? { location } : {}),
  }
}

function toLocation(address: FixtureAddress): NonNullable<Account['location']> {
  return {
    line1: address.line1,
    locality: address.locality,
    countrySubd: address.countrySubd,
    postal1: address.postal1,
    ...(address.line2 !== undefined ? { line2: address.line2 } : {}),
    ...(address.postal2 !== undefined ? { postal2: address.postal2 } : {}),
    ...(address.unitNbr !== undefined ? { unitNbr: address.unitNbr } : {}),
    ...(address.unitType !== undefined ? { unitType: address.unitType } : {}),
    ...(address.oneLine !== undefined ? { oneLine: address.oneLine } : {}),
    ...(!address.omitLatLng && address.latlng ? { latlng: address.latlng } : {}),
  }
}

function toPayload(fixture: ParityFixture): CalendarEventWebhook {
  if (fixture.payload.action === 'remove') {
    return {
      entity: 'Event',
      action: 'remove',
      data: {
        id: fixture.payload.id as CalendarEventId,
        ...(fixture.payload.sourceId !== undefined ? { sourceId: fixture.payload.sourceId } : {}),
      },
    }
  }
  const data: EventData = {
    id: fixture.payload.id as CalendarEventId,
    eventType: fixture.payload.eventType,
    eventDate: fixture.payload.eventDate,
    duration: fixture.payload.duration,
    ...(fixture.payload.includeStatus && fixture.payload.status !== undefined
      ? { status: fixture.payload.status }
      : {}),
    ...(fixture.payload.sourceId !== undefined ? { sourceId: fixture.payload.sourceId } : {}),
    ...(fixture.payload.owner ? { owner: toUser(fixture.payload.owner) } : {}),
    ...(fixture.payload.attendee ? { attendee: toUser(fixture.payload.attendee) } : {}),
    ...(fixture.payload.accountId ? { account: { accountId: fixture.payload.accountId as AccountId } } : {}),
  }
  return { entity: 'Event', action: fixture.payload.action, data }
}

function toUser(user: FixtureUser): NonNullable<EventData['owner']> {
  return {
    firstName: user.firstName,
    lastName: user.lastName,
    ...(user.closerStatus !== undefined ? { closerStatus: user.closerStatus } : {}),
    ...(user.clientUserId !== undefined ? { clientUserId: user.clientUserId } : {}),
  }
}
