import { TerrosApiError } from '@terros-inc/connect-common'
import { loadInternalSchemaWithStatus } from './crud/internal'

const HOW_TO_IMPERSONATE =
  'find the user with `terros search --query "<name>"` (keep the User result in their company), then run the command with `TERROS_IMPERSONATE=<userId>` set and confirm with `TERROS_IMPERSONATE=<userId> terros whoami`.'

export const STAFF_IMPERSONATION_HELP = `Staff: acting as a customer
  Reads are scoped to the acting user's company, so as yourself another company's records look missing or empty.
  For a customer's question, act as one of their admins or the affected user:
    terros search --query "<name>"                    find their userId (keep the User in their company)
    TERROS_IMPERSONATE=<userId> terros whoami         confirm who you are acting as
    TERROS_IMPERSONATE=<userId> terros <command> ...
  Use the staff login only for internal endpoints such as entitlements and feature flags.
  A command that takes --companyId is no reason to stay as staff.`

/** Flags people guess for acting as someone else, lowercased; the CLI only reads that from `TERROS_IMPERSONATE`. */
const IMPERSONATION_FLAGS = new Set(['impersonate', 'as', 'asuser', 'user', 'companyid'])

/** The unknown-flag error for a guessed impersonation flag, which a schema refresh would never make valid. */
export function impersonationFlagMessage(unknownParameters: string[]): string | undefined {
  const guessed = unknownParameters.filter((name) => IMPERSONATION_FLAGS.has(name.toLowerCase()))
  if (guessed.length === 0) return undefined
  return `Unknown parameter(s): ${unknownParameters.map((name) => `--${name}`).join(', ')}. The CLI has no flag to act as another user or company. To read a customer's data, act as one of their admins or the affected user: ${HOW_TO_IMPERSONATE}`
}

/**
 * A stderr hint when staff signed in as themselves get a failure or an empty result that usually means the record is
 * in a customer's company, not that it is missing. Staff is the same signal that loads the internal schema; an
 * impersonating caller already acts in some company, so whatever they got is that company's answer.
 */
export async function companyScopeHint(
  outcome: { error: unknown } | { response: unknown }
): Promise<string | undefined> {
  const lead =
    'error' in outcome
      ? isCompanyScopedFailure(outcome.error) && 'The record may belong to another company.'
      : isEmptyResult(outcome.response) && 'No results here may mean the records belong to another company.'
  if (!lead || process.env.TERROS_IMPERSONATE) return undefined
  if ((await loadInternalSchemaWithStatus()).status !== 'available') return undefined
  return `Hint: you are signed in as Terros staff, not impersonating, so reads only see your own company. ${lead} To act as one of its admins or the affected user, ${HOW_TO_IMPERSONATE}`
}

function isCompanyScopedFailure(error: unknown): boolean {
  if (!(error instanceof TerrosApiError)) return false
  return (
    error.code === 'NotAuthorized' ||
    error.code === 'NotFound' ||
    (error.response.message?.startsWith('Unauthorized workflow IDs') ?? false)
  )
}

/** A success with a list and nothing else: every list empty, and no single record such as a matched account. */
function isEmptyResult(response: unknown): boolean {
  if (response === null || typeof response !== 'object') return false
  const values = Object.values(response)
  return (
    values.some((value) => Array.isArray(value)) &&
    values.every((value) => (Array.isArray(value) ? value.length === 0 : value === null || typeof value !== 'object'))
  )
}
