import type { TeamId, UserId } from '../user'
import type { AuditProps } from '../shared'

type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
type WeekOfYear = `0${Exclude<Digit, 0>}` | `${1 | 2 | 3 | 4}${Digit}` | `5${0 | 1 | 2}`

/** A week as `W<year>|<week 01-52>`, such as `W2026|47`. */
export type WeeklyPeriodValue = `W${number}|${WeekOfYear}`
/** A quarter as `Q<year>|<quarter 1-4>`, such as `Q2026|4`. */
export type QuarterlyPeriodValue = `Q${number}|${1 | 2 | 3 | 4}`
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

/** `Pitch`, an account status ID (`AS.`), or a workflow stage ID (`S.`). */
export type PlanStageId = 'Pitch' | `S.${string}` | `AS.${string}`

export type PlanMilestone =
  | 'Pitch'
  | 'Lead'
  | 'Set'
  | 'Sit'
  | 'Closed'
  | 'Approved'
  | 'Permit Submitted'
  | 'Permit Approved'
  | 'Installed'
  | 'Archived'
  | 'Do Not Contact'

/** One stage target of a plan. Dashboards show `quantityRequired` as the stage's target when `pricePerUnit` is unset. */
export type PlanStageData = {
  milestone: PlanMilestone
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

/** The plan fields a caller sets; the server sets the audit fields. */
export type PlanFields = {
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

export type PlanData = AuditProps & PlanFields & PlanPeriod & PlanScope
