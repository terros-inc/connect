import { type AttachmentId } from '../calendar'
import { type RangeFilter } from '../account/api'

export type CustomFieldId = `CF.${string}`
/** use null to clear this field */
export type CustomFieldType = string | number | boolean | AttachmentId | null
export type CustomFieldMap = Record<CustomFieldId, CustomFieldType>

export type CustomFieldFilter = Record<CustomFieldId, CustomFieldFilterValue>

export type CustomFieldFilterValue =
  | {
      type: 'range'
      range: RangeFilter
    }
  | {
      type: 'multipleChoice'
      values: CustomFieldType[]
    }
  | {
      type: 'exists'
      exists: boolean
    }
