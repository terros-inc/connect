import { packageScripts } from '../connect/package.ts'
import { cleanBuildDir } from '../connect/clean.ts'

export const connectCommands = {
  pack: {
    description: 'Package Terros Connect scripts',
    async run() {
      await cleanBuildDir()
      await packageScripts()
    },
  },
}
