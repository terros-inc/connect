import { ConnectConfig } from './configSchema'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const str = JSON.stringify(ConnectConfig.toJSONSchema(),null,2)

const path = join(import.meta.dirname, 'configSchema.json')
writeFileSync(path, str)
