import { cwd } from 'node:process'
import { join } from 'node:path'
import { z } from 'zod'
import { readFile } from 'node:fs/promises'
import { CONFIG_FILE_NAME } from './constants.ts'

const BaseScript = z.object({
  name: z.string(),
  entrypoint: z.string()
})

const Script = z.intersection(
  BaseScript,
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('scheduled'),
      cron: z.string(),
    }),
    z.object({
      type: z.literal('outgoing'),
      dataType: z.enum(['Account', 'Company', 'User', 'Event']),
    }),
    z.object({
      type: z.literal('incoming'),
    }),
  ])
)
export type Script = z.infer<typeof Script>

const ConnectConfig = z.object({
  appId: z.string(),
  scripts: z.array(Script),
})

type ConnectConfig = z.infer<typeof ConnectConfig>

export async function readConnectConfig(): Promise<ConnectConfig> {
  const file = join(cwd(), CONFIG_FILE_NAME)
  const contents = await readFile(file, { encoding: 'utf-8' })
  return ConnectConfig.parse(JSON.parse(contents))
}
