import type { ApiSuccess } from '@terros-inc/connect-common'
import type { WorkflowId } from '../account'
import type { RoleData, UnsavedUser, UserId, UserProfileData } from '../user'
import type {
  AccessStatus,
  BillingMethod,
  CompanyData,
  CompanyId,
  CompanyKind,
  PartialCompanyData,
  TinyCompany,
  UnsavedCompany,
} from './model'

export type CompanyListInput = {
  archived?: true | false | 'all'
  owners?: UserId[]
  accessStatuses?: AccessStatus[]
  billingMethods?: BillingMethod[]
  kinds?: CompanyKind[]
}

export type CompanyListSuccess = ApiSuccess<{
  companies: TinyCompany[]
}>

export type CompanyGetInput = {
  companyId?: CompanyId
}

export type CompanyGetSuccess = ApiSuccess<{
  company: CompanyData
}>

export type CompanyAddInput = UnsavedCompany

export type CompanyAddSuccess = ApiSuccess<{
  company: CompanyData
  roles: RoleData[]
}>

export type CompanyUpdateInput = {
  company: PartialCompanyData
}

export type CompanyUpdateSuccess = ApiSuccess<{
  company: CompanyData
}>

export type CompanyRemoveInput = {
  companyId: CompanyId
  archive?: boolean
}

export type CompanyRemoveSuccess = ApiSuccess

export type CompanySetupInput = {
  company: UnsavedCompany
  admin: UnsavedUser
  templateId?: CompanyId
  workflowId?: WorkflowId
}

export type CompanySetupSuccess = ApiSuccess<{
  company: CompanyData
  roles: RoleData[]
  user: UserProfileData
  password?: string
}>
