import type { RawConfig } from '../config.ts'

export type ParityOutcome = 'processed' | 'skipped' | 'noop' | 'threw'

export type StRequest = {
  method: string
  path: string
  query: Record<string, string>
  body: unknown
  retries?: number
}

export type TerrosWrite =
  | { op: 'updateAccountCustomField'; accountId: string; fieldId: string; value: string }
  | { op: 'writeEventSourceId'; eventId: string; value: string }

export type ReplayResult = {
  stRequests: StRequest[]
  terrosWrites: TerrosWrite[]
  outcome: ParityOutcome
}

export type GoldenFile = ReplayResult & {
  legacySha: string
  scenario: number
}

export type FaultSpec = {
  method: string
  pathIncludes: string
  statuses: number[]
}

export type FixtureUser = {
  firstName: string
  lastName: string
  email?: string
  closerStatus?: string
  clientUserId?: string
}

export type FixtureAddress = {
  line1: string
  locality: string
  countrySubd: string
  postal1: string
  line2?: string
  postal2?: string
  unitNbr?: string
  unitType?: string
  oneLine?: string
  latlng?: { latitude: number; longitude: number }
  omitLatLng?: boolean
}

export type FixtureResident = {
  businessName?: string
  firstName?: string
  lastName?: string
  name?: string
  email?: string
  phone?: string
}

export type ParityFixture = {
  id: number
  name: string
  planExpect: string
  echoOf?: number
  companyId: string
  credentials: { appKey: string; clientId: string; clientSecret: string; tenantId: string } | null
  connectConfig: RawConfig
  payload: {
    action: 'add' | 'update' | 'remove'
    id: string
    sourceId?: string
    eventType: string
    eventDate: string
    duration: number
    includeStatus: boolean
    status?: string
    title?: string
    attendee: FixtureUser | null
    owner: FixtureUser | null
    accountId: string | null
  }
  account: {
    accountId: string
    accountSource: string
    resident: FixtureResident | null
    location: FixtureAddress | null
    customFields?: Record<string, string>
  } | null
  canonicalLocation?: FixtureAddress | null
  seed: {
    customers: { id: number; name: string; customFields?: { typeId: number; value: string }[] }[]
    locations: { id: number; customerId: number; name: string }[]
    jobs: {
      id: number
      customerId: number
      locationId: number
      campaignId: number
      lastAppointmentId: number
      businessUnitId: number
      jobTypeId: number
      customFields: { typeId: number; value: string }[]
    }[]
    appointments: { id: number; jobId: number; customerId: number; start: string; end: string }[]
    assignments: { id: number; technicianId: number; jobId: number; appointmentId: number; active: boolean }[]
    technicians: { id: number; name: string; businessUnitId?: number; team?: string; active?: boolean }[]
  }
  faults: FaultSpec[]
}
