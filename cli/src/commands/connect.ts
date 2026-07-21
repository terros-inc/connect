import { packageScripts } from '../connect/package'
import { cleanBuildDir } from '../connect/clean'

export const connectCommands = {
  pack: {
    description: 'Package Terros Connect scripts',
    async run() {
      await cleanBuildDir()
      await packageScripts()
    },
  },
}
