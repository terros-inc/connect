import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { ConnectConfig } from './configSchema.ts'

const str = `${JSON.stringify(ConnectConfig.toJSONSchema(), null, 2)}\n`

const path = join(import.meta.dirname, '../../configSchema.json')
writeFileSync(path, str)
