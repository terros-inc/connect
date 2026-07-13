type Parts = {
  group: string
  alias: string
}

export function getPathParts(path: string): Parts {
  const parts = path.substring(1).split('/')
  if (parts.length < 2) throw new Error('Tried to parse path with fewer than 2 parts')
  return {
    group: parts.at(-2) as string,
    alias: parts.at(-1) as string,
  }
}
