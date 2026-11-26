import { cleanBuildDir } from '../connect/clean'
import { packageScripts } from '../connect/package'
import { publishConnectScripts } from '../connect/publish'
import { runConnectValidation } from '../connect/validate'

export const connectCommands = {
  validate: {
    description: 'Validate Terros Connect scripts against the server schema',
    async run() {
      await runConnectValidation()
    },
  },
  pack: {
    description: 'Package Terros Connect scripts',
    async run() {
      await cleanBuildDir()
      await packageScripts()
    },
  },
  publish: {
    description: 'Package and publish Terros Connect scripts',
    async run() {
      await publishConnectScripts()
    },
  },
}
