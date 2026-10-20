import type { ParsedArgs } from 'minimist'

/** A text flag's value, or undefined when the flag is absent. minimist parses `--name 123` as a number. */
export function readTextFlag(params: ParsedArgs, name: string): string | undefined {
  const value: unknown = params[name]
  if (value === undefined) return undefined
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  throw new Error(`--${name} needs a single value`)
}

export function rejectUnknownFlags(params: ParsedArgs, known: string[]): void {
  const unknown = Object.keys(params).filter((name) => name !== '_' && !known.includes(name))
  if (unknown.length > 0) throw new Error(`Unknown parameter(s): ${unknown.map((name) => `--${name}`).join(', ')}`)
}
