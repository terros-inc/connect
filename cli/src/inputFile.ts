import { readFileSync } from 'node:fs'
import type { ParsedArgs } from 'minimist'

export const INPUT_FILE_FLAG = 'inputFile'

/** Split `--inputFile <path>` (`-` for stdin) off the flags and read it as the base request body. */
export function readInputFile(params: ParsedArgs): { params: ParsedArgs; base?: Record<string, unknown> } {
  const { [INPUT_FILE_FLAG]: path, ...rest } = params
  if (path === undefined) return { params }
  if (typeof path !== 'string' || path === '')
    throw new Error(`--${INPUT_FILE_FLAG} expects a file path, or - for stdin`)

  const text = readFileSync(path === '-' ? 0 : path, 'utf8')
  let base: unknown
  try {
    base = JSON.parse(text)
  } catch {
    throw new Error(`--${INPUT_FILE_FLAG} ${path} is not valid JSON`)
  }
  if (base === null || typeof base !== 'object' || Array.isArray(base)) {
    throw new Error(`--${INPUT_FILE_FLAG} ${path} must hold a JSON object, the request body`)
  }
  return { params: rest as ParsedArgs, base: base as Record<string, unknown> }
}
