import type { TeamId, UserId } from '../user'
import type { AuditProps } from '../shared'

/** A week as `W<year>|<week 01-52>`, such as `W2026|47`. */
export type WeeklyPeriodValue = `W${number}|${number}`
/** A quarter as `Q<year>|<quarter 1-4>`, such as `Q2026|4`. */
export type QuarterlyPeriodValue = `Q${number}|${number}`
export type PlanPeriodValue = WeeklyPeriodValue | QuarterlyPeriodValue

/** Plans exist only for weeks and quarters. */
export const PLAN_PERIOD_TYPES = ['week', 'quarter'] as const
export type PlanPeriodType = (typeof PLAN_PERIOD_TYPES)[number]

export type PlanPeriod =
  | { periodType: 'week'; period: WeeklyPeriodValue }
  | { periodType: 'quarter'; period: QuarterlyPeriodValue }

/** A plan belongs to a user or to a team, such as an office. */
export type PlanScope = { scope: 'user'; scopeId: UserId } | { scope: 'team'; scopeId: TeamId }
export type PlanScopeId = UserId | TeamId

export type PlanStatus = 'Pending' | 'Submitted' | 'Approved' | 'Rejected' | 'Closed'

/** `Pitch`, or a workflow stage ID. */
export type PlanStageId = 'Pitch' | `S.${string}` | `AS.${string}`

/** One stage target of a plan. Dashboards show `quantityRequired` as the stage's target when `pricePerUnit` is unset. */
export type PlanStageData = {
  milestone: string
  stageId?: PlanStageId
  conversionRate: number
  quantityRequired?: number
  pricePerUnit?: number
  actual?: number
  pace?: number
}

export type DailyPlan = {
  /** ISO 8601 date, such as `2026-11-19`. */
  date: string
  working?: number
  targetPitches?: number
  workingHours?: { startTime: number; endTime: number }
}

export type PlanFields = AuditProps & {
  status: PlanStatus
  days: DailyPlan[]
  comments?: string
  targetIncome?: number
  workflowId?: `WF.${string}`
  setter?: PlanStageData[]
  closer?: PlanStageData[]
  selfgen?: PlanStageData[]
  questionsAndAnswers?: { question: string; answer?: string }[]
}

export type PlanData = PlanFields & PlanPeriod & PlanScope
