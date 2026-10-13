import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from '@modelcontextprotocol/server'

export type Auth0VerifierOptions = {
  issuer: string
  audience: string
  /** Key source; defaults to the issuer's JWKS. Tests inject a local key set. */
  keys?: JWTVerifyGetKey
}

/** Verify Auth0-issued JWT access tokens: signature, issuer, audience and a required, unexpired `exp`. */
export function createAuth0Verifier(options: Auth0VerifierOptions): OAuthTokenVerifier {
  const keys = options.keys ?? createRemoteJWKSet(new URL('.well-known/jwks.json', options.issuer))
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer: options.issuer,
          audience: options.audience,
          algorithms: ['RS256'],
          requiredClaims: ['exp'],
        })
        const scope = typeof payload.scope === 'string' ? payload.scope : ''
        const clientId = typeof payload.azp === 'string' ? payload.azp : payload.client_id
        return {
          token,
          clientId: typeof clientId === 'string' ? clientId : '',
          scopes: scope.split(' ').filter(Boolean),
          expiresAt: payload.exp,
        }
      } catch {
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid access token')
      }
    },
  }
}
