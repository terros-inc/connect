import type { UserId } from '../user'

export type CompanyKind = 'customer' | 'sandbox' | 'demo' | 'template' | 'development'
export type AccessStatus = 'active' | 'suspended'
export type BillingMethod = 'stripe' | 'none'
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

export type CompanyData = {
  companyId: CompanyId
  name: string
  legalName?: string
  kind: CompanyKind
  accessStatus: AccessStatus
  internalOwnerId?: UserId
  billingEmail?: string
  billingMethod?: BillingMethod
  maxUsers?: number
  size?: number
  industries?: CompanyIndustry[]
  salesChannels?: string[]
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
  isDeleted?: boolean
  createdAt?: number
  createdBy?: UserId
  updatedAt?: number
  updatedBy?: UserId
}
