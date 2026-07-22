import type { UserId, UserProfileData } from './user'
import type { CompanyData, CompanyId } from './company'

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
