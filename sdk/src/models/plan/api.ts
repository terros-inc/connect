import type { ApiSuccess } from '@terros-inc/connect-common'
import type { PlanData, PlanFields, PlanPeriod, PlanPeriodValue, PlanScope, PlanScopeId } from './model'

export type PlanListInput = {
  /** Omit to use the authenticated user. */
  scopeId?: PlanScopeId
  period?: PlanPeriodValue
  /** With a team `scopeId`, list each member's plan for `period` (default: the current quarter). */
  includeTeamMembers?: boolean
}

export type PlanListSuccess = ApiSuccess<{
  plans: PlanData[]
}>

export type PlanGetInput = {
  /** Omit to use the authenticated user. */
  scopeId?: PlanScopeId
  period: PlanPeriodValue
}

export type PlanGetSuccess = ApiSuccess<{
  plan: PlanData
}>

export type PlanAddInput = {
  plan: PlanData
}

export type PlanUpdateInput = {
  /** Picks the plan by scope and period; the other fields given replace the stored ones. */
  planData: Partial<PlanFields> & PlanPeriod & PlanScope
}
