/** Reserved CLI word: `terros <words> help` shows help, so no endpoint path may use it as a segment. */
export const HELP_WORD = 'help'

/** CLI command words for an endpoint path: every path segment, in order (`/garden/bed/list` → `garden bed list`). */
export function getCommandWords(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '')
}

/** Splits `a | (b | c)[] | { d: e | f }` on the `|` that are not inside parentheses, braces, brackets or quotes. */
export function splitTopLevelUnion(type: string): string[] {
  const members: string[] = []
  let depth = 0
  let inString = false
  let start = 0
  for (let index = 0; index < type.length; index++) {
    const char = type[index]
    if (inString) {
      if (char === '\\') index++
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '(' || char === '{' || char === '[') depth++
    else if (char === ')' || char === '}' || char === ']') depth--
    else if (char === '|' && depth === 0) {
      members.push(type.slice(start, index).trim())
      start = index + 1
    }
  }
  members.push(type.slice(start).trim())
  return members.filter((member) => member !== '')
}
