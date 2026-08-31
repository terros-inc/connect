import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts')) {
      try {
        return nextResolve(`${specifier}.ts`, context)
      } catch {}
    }

    return nextResolve(specifier, context)
  },
})

const { ConnectConfig } = await import('./configSchema')

const str = JSON.stringify(ConnectConfig.toJSONSchema(),null,2)

const path = join(import.meta.dirname, 'configSchema.json')
writeFileSync(path, str)
