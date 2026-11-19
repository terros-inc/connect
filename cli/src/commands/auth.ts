import { AuthRequiredError, getTokens, saveTokens } from '@terros-inc/connect-common/auth'
import { interactiveSignInRefusal, resolveEnvironment } from '@terros-inc/connect-common'
import { clearRuntimeCaches } from '../cache'
import { signInToAuth0 } from '../auth/auth0'

export const authCommands = {
  login: {
    description: 'Sign in to Terros',
    async run() {
      const refusal = interactiveSignInRefusal(resolveEnvironment())
      if (refusal) throw new Error(refusal)
      const tokens = await signInToAuth0()
      await saveTokens(tokens)
      await clearRuntimeCaches()
      console.log('Signed in successfully')
    },
  },
  token: {
    description: 'Get Terros API Token',
    async run() {
      const tokens = await getTokens()
      if (tokens === null) throw new AuthRequiredError('signed-out')
      process.stdout.write(tokens.access_token)
    },
  },
}
