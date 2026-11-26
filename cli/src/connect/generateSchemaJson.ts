import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConnectConfig } from './configSchema'

const str = JSON.stringify(ConnectConfig.toJSONSchema(), null, 2)

const path = join(import.meta.dirname, '../../configSchema.json')
writeFileSync(path, str)
