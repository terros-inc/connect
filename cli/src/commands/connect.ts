import { runConnectValidation } from '../connect/validate'
import { publishConnectScripts } from '../connect/publish'
import { packageScripts } from '../connect/package'
import { cleanBuildDir } from '../connect/clean'

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
