/** Reserved CLI word: `terros <words> help` shows help, so no endpoint path may use it as a segment. */
export const HELP_WORD = 'help'

/** CLI command words for an endpoint path: every path segment, in order (`/garden/bed/list` → `garden bed list`). */
export function getCommandWords(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '')
}
