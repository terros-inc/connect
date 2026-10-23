import type { SmallUser, UserId, UserProfileData } from './user'
import type { SmallAddress } from './location'
import type { CustomFieldMap } from './customFields'
import type { CompanyData, CompanyId } from './company'
import type { AccountId, AccountNote, TinyResidentData, WorkflowActionId, WorkflowId, WorkflowStageId } from './account'

export type WebhookAuditProps = {
  createdAt: string
  updatedAt: string
}

export type WebhookAddUpdatePayload<Entity extends string, Payload> = {
  entity: Entity
  action: 'add' | 'update'
  data: Payload
}

export type WebhookRemovePayload<Entity extends string, Payload> = {
  entity: Entity
  action: 'remove'
  data: Payload
}

export type WebhookPayload<Entity extends string, DataPayload, Key extends keyof DataPayload> =
  | WebhookAddUpdatePayload<Entity, DataPayload>
  | WebhookRemovePayload<Entity, DataPayload[Key]>

export type UserWebhookData = WebhookAuditProps &
  Pick<
    UserProfileData,
    | 'firstName'
    | 'lastName'
    | 'email'
    | 'phone'
    | 'clientUserId'
    | 'preferredName'
    | 'timeZone'
    | 'closerStatus'
    | 'isDeleted'
    | 'customFields'
  > & {
    id: UserId
  }
export type UserWebhook = WebhookPayload<'User', UserWebhookData, 'id'>

export type CompanyWebhookData = WebhookAuditProps &
  Omit<CompanyData, 'companyId'> & {
    id: CompanyId
  }
export type CompanyWebhook = WebhookPayload<'Company', CompanyWebhookData, 'id'>

export type AccountWebhookWorkflowState = {
  workflowId: WorkflowId
  stageId: WorkflowStageId
  actionId?: WorkflowActionId
  stageName?: string
  actionName?: string
  sourceStage?: string
}

/**
 * The Account webhook payload as Terros sends it. It is not AccountData: the homeowner is `resident`,
 * the address is `address` and custom fields are `customFieldMap`.
 */
export type AccountWebhookData = WebhookAuditProps & {
  id: AccountId
  accountStatus?: string
  workflowState?: AccountWebhookWorkflowState
  owner?: SmallUser
  closer?: SmallUser
  address?: SmallAddress
  resident?: TinyResidentData
  note?: string
  notes?: AccountNote[]
  externalLeadId?: string
  customFieldMap?: CustomFieldMap
}
export type AccountWebhook = WebhookPayload<'Account', AccountWebhookData, 'id'>
