import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthMetadata,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server'

export type Auth0VerifierOptions = {
  issuer: string
  audience: string
  /** Key source; defaults to the issuer's JWKS. Tests inject a local key set. */
  keys?: JWTVerifyGetKey
}

/** Verify Auth0-issued JWT access tokens: signature, issuer, audience and expiry. */
export function createAuth0Verifier(options: Auth0VerifierOptions): OAuthTokenVerifier {
  const keys = options.keys ?? createRemoteJWKSet(new URL('.well-known/jwks.json', options.issuer))
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer: options.issuer,
          audience: options.audience,
          algorithms: ['RS256'],
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

/** RFC 8414 metadata for an Auth0 tenant, advertised so MCP clients can find the authorization server. */
export function auth0Metadata(issuer: string): OAuthMetadata {
  return {
    issuer,
    authorization_endpoint: new URL('authorize', issuer).href,
    token_endpoint: new URL('oauth/token', issuer).href,
    registration_endpoint: new URL('oidc/register', issuer).href,
    jwks_uri: new URL('.well-known/jwks.json', issuer).href,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
  }
}
