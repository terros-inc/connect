import type { TinyUser } from './model'

/**
 * The name the Terros app shows for a user: their trimmed preferred name, else their trimmed first name.
 * Mirrors `getPreferredName` in the Sales app's shared `common` package, which this public SDK cannot depend
 * on; keep the two in step.
 */
export function getPreferredName(user: Pick<TinyUser, 'firstName' | 'preferredName'> | undefined): string {
  return user?.preferredName?.trim() || user?.firstName?.trim() || ''
}
