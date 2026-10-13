import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from '@modelcontextprotocol/server'

export type Auth0VerifierOptions = {
  issuer: string
  audience: string
  /** Key source; defaults to the issuer's JWKS. Tests inject a local key set. */
  keys?: JWTVerifyGetKey
}

/**
 * Verify Auth0-issued JWT access tokens in the RFC 9068 profile (the MCP APIs' JWT profile): an `at+jwt` header,
 * signature, issuer, audience and the profile's required claims, including an unexpired `exp`. A token in Auth0's
 * own profile (`typ: JWT`, client ID in `azp`, no `jti`) is rejected, as is an ID token, which lacks `at+jwt`.
 */
export function createAuth0Verifier(options: Auth0VerifierOptions): OAuthTokenVerifier {
  const keys = options.keys ?? createRemoteJWKSet(new URL('.well-known/jwks.json', options.issuer))
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer: options.issuer,
          audience: options.audience,
          algorithms: ['RS256'],
          typ: 'at+jwt',
          requiredClaims: ['exp', 'iat', 'sub', 'client_id', 'jti'],
        })
        const scope = typeof payload.scope === 'string' ? payload.scope : ''
        return {
          token,
          clientId: String(payload.client_id),
          scopes: scope.split(' ').filter(Boolean),
          expiresAt: payload.exp,
        }
      } catch {
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid access token')
      }
    },
  }
}
