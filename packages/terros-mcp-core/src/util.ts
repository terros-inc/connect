type Parts = {
  group: string
  alias: string
}

// A nested path whose group is also a top-level command (e.g. /program/user/list next to /user/list)
// is qualified with its parent (programUser list) so neither command replaces the other.
export function getPathParts(path: string, topLevelGroups: ReadonlySet<string> = new Set()): Parts {
  const parts = path.substring(1).split('/')
  const alias = parts.at(-1) as string
  const group = parts.at(-2) ?? alias
  const parent = parts.at(-3)
  if (parent && topLevelGroups.has(group)) {
    return { group: `${parent}${group.charAt(0).toUpperCase()}${group.slice(1)}`, alias }
  }
  return { group, alias }
}

export function getTopLevelGroups(paths: string[]): Set<string> {
  return new Set(paths.map((path) => path.substring(1).split('/')[0] as string))
}
