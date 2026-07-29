import { type AttachmentId } from '../calendar'

export type CustomFieldId = `CF.${string}`
/** use null to clear this field */
export type CustomFieldType = string | number | boolean | AttachmentId | null
export type CustomFieldMap = Record<CustomFieldId, CustomFieldType>
