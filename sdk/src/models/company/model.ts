import type { AuditProps } from '../shared'
import type { UserId } from '../user'

export type CompanyKind = 'customer' | 'sandbox' | 'demo' | 'template' | 'development'
export type AccessStatus = 'active' | 'suspended'
export type BillingMethod = 'stripe' | 'none'
export type CompanySize = number
export type CompanyIndustry =
  | 'solar'
  | 'pest'
  | 'alarm'
  | 'roofing'
  | 'fiber'
  | 'insurance'
  | 'home_improvement'
  | 'windows'
  | 'satellite_tv'
  | 'retail'
  | 'other'
  | 'solar_cleaning'

export type CompanyId = `C:${string}` | `C.${string}`

export type DemoState = 'Ready' | 'Copying' | 'Failed'

export type ManualAccessOverride = AuditProps & {
  accessStatus: AccessStatus
  note?: string
  expiresAt: number
}

export type UnsavedCompany = {
  name: string
  legalName?: string
  kind?: CompanyKind
  accessStatus?: AccessStatus
  internalOwnerId?: UserId
  billingEmail?: string
  billingMethod?: BillingMethod
  maxUsers?: number
  parentCompanyId?: CompanyId
  salesforceAccountId?: string
  size?: CompanySize
  industries?: CompanyIndustry[]
  salesChannels?: string[]
  demoOwnerId?: UserId
}

export type CompanyData = AuditProps &
  UnsavedCompany & {
    companyId: CompanyId
    kind: CompanyKind
    accessStatus: AccessStatus
    accessOverride?: ManualAccessOverride
    highestTeamLevel?: number
    lowestTeamLevel?: number
    levelNames?: Record<string, string>
    timeZone?: string
    avatarUrl?: string
    avatarBlurhash?: string
    uploadAvatarUrl?: string
    iconUrl?: string
    iconBlurhash?: string
    uploadIconUrl?: string
    demoState?: DemoState
    activeUserCount?: number
    isDeleted?: boolean
  }

export type PartialCompanyData = Partial<CompanyData> & {
  companyId: CompanyId
  legalName?: string | null
  internalOwnerId?: UserId | null
  salesforceAccountId?: string | null
  demoOwnerId?: UserId | null
}

export type TinyCompany = Pick<
  CompanyData,
  | 'companyId'
  | 'name'
  | 'kind'
  | 'accessStatus'
  | 'modifiedBy'
  | 'demoState'
  | 'avatarUrl'
  | 'avatarBlurhash'
  | 'maxUsers'
  | 'activeUserCount'
  | 'salesforceAccountId'
>
