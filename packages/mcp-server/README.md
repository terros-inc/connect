# @terros-inc/mcp-server

The hosted remote MCP server for the Terros API, served at the root of `https://mcp.terros.com` (prod) and
`https://mcp.staging.terros.com` (staging), with no path. It exposes the same endpoint-generated tools as `terros mcp`
(both are built by `@terros-inc/mcp-core`), but over Streamable HTTP for remote MCP clients such as Claude, ChatGPT
and Cursor. Private: it is deployed, not published to npm.

## How it works

- `POST /` is stateless. Every request is served by a fresh `McpServer` with its own API client. There is no
  server-wide API key: the server refuses to start if `TERROS_API_KEY` is set.
- `GET` and `DELETE /` (session streams and termination) return `405` with a JSON-RPC error body. Other paths,
  including `/mcp`, return `404`.
- Clients present Auth0 access tokens issued for the server itself (audience: its own URL, `https://mcp.terros.com`
  in prod and `https://mcp.staging.terros.com` in staging). Tokens are checked for signature (the issuer's JWKS),
  issuer, audience and a required, unexpired `exp` before any server is built. Requests without a valid token get
  `401` with a `WWW-Authenticate` challenge carrying a `resource_metadata` URL, `/.well-known/oauth-protected-resource`,
  which names Auth0 as the authorization server (RFC 9728). Neither carries OAuth scopes: Terros puts no permissions in
  scopes, and what a user may do is decided by the Terros API's own permission checks. Clients read the authorization
  server metadata from Auth0 itself.
- No token passthrough: the MCP-audience token never reaches the Terros API. On a request's first API call the
  server exchanges it at Auth0 (RFC 8693 Custom Token Exchange) for a Terros API-audience token for the same user, and
  calls the API with that. The server authenticates the exchange as an Auth0 Machine to Machine application whose
  client secret is read from AWS Secrets Manager.
- `GET /health` returns `{"status":"ok","version":"…"}` without authentication.
- Host and Origin are enforced by WAF at the gateway and again in the handler (DNS-rebinding protection). Browser
  origins must be exactly `https://<allowlisted hostname>`.

| File                            | Purpose                                                                    |
| ------------------------------- | -------------------------------------------------------------------------- |
| `src/handler.ts`                | Web-standard `fetch(Request)` handler: routing, auth, per-request server   |
| `src/auth.ts`                   | Auth0 JWT verifier                                                         |
| `src/exchange.ts`               | Auth0 token exchange: MCP token → Terros API token for the same user       |
| `src/client.ts`                 | Per-request Terros API client (exchanged token, at most one exchange)      |
| `src/config.ts`                 | Environment configuration                                                  |
| `src/proxy.ts`, `src/lambda.ts` | API Gateway proxy adapter and Lambda entry point                           |
| `infra/`                        | AWS CDK app: API Gateway, Lambda, WAF, logs, Route 53 health check, alarms |

## Commands

Run from this directory:

- `pnpm test`: handler, adapter and infrastructure (CDK assertion) tests; no AWS access needed
- `pnpm typecheck`: `tsc --noEmit` over `src` and `infra`
- `pnpm build`: build the workspace dependencies, then bundle `src/lambda.ts` and its dependencies into `dist/lambda.mjs` (the AWS SDK is left to the Lambda runtime)
- `pnpm package`: download the OpenAPI document, build, and copy it to `dist/terros.yml` (the Lambda asset)
- `pnpm cdk synth|diff|deploy -c stage=<staging|prod> …`: see the runbook

Deploying, DNS, Auth0 and the live client checks are done by a person: see [docs/RUNBOOK.md](docs/RUNBOOK.md).
