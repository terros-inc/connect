type Parts = {
  group: string
  alias: string
}

export function getPathParts(path: string): Parts {
  const parts = path.substring(1).split('/')
  const alias = parts.at(-1) as string
  return {
    group: parts.at(-2) ?? alias,
    alias,
  }
}
