import { getTokens, saveTokens } from '../auth/tokens.ts'
import { signInToAuth0 } from '../auth/auth0.ts'

export const authCommands = {
  login: {
    description: 'Sign in to Terros',
    async run() {
      const tokens = await signInToAuth0()
      await saveTokens(tokens)
      console.log('Signed in successfully')
    },
  },
  token: {
    description: 'Get Terros API Token',
    async run() {
      const tokens = await getTokens()
      if (tokens === null) {
        console.error('CLI not authorized. Run \`terros auth login\` to authenticate.')
        return
      }
      process.stdout.write(tokens.access_token)
    },
  },
}
