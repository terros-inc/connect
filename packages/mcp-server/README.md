# @terros-inc/mcp-server

The hosted remote MCP server for the Terros API, served at `https://mcp.terros.com/mcp` (prod) and
`https://mcp-staging.terros.com/mcp` (staging). It exposes the same endpoint-generated tools as `terros mcp`
(both are built by `@terros-inc/mcp-core`), but over Streamable HTTP for remote MCP clients such as Claude and Cursor.
Private: it is deployed, not published to npm.

## How it works

- `POST /mcp` is stateless. Every request is served by a fresh `McpServer` whose API client carries that request's
  own Auth0 access token. There is no server-wide API key: the server refuses to start if `TERROS_API_KEY` is set.
- `GET` and `DELETE /mcp` (session streams and termination) return `405` with a JSON-RPC error body.
- Requests without a valid token get `401` with a `WWW-Authenticate` challenge that points at
  `/.well-known/oauth-protected-resource/mcp`, which names Auth0 as the authorization server (RFC 9728).
  Tokens are checked for signature (the issuer's JWKS), issuer, audience and expiry before any server is built.
- `GET /health` returns `{"status":"ok","version":"…"}` without authentication.
- Host and Origin are enforced by WAF at the gateway and again in the handler (DNS-rebinding protection).

| File                            | Purpose                                                                    |
| ------------------------------- | -------------------------------------------------------------------------- |
| `src/handler.ts`                | Web-standard `fetch(Request)` handler: routing, auth, per-request server   |
| `src/auth.ts`                   | Auth0 JWT verifier and authorization server metadata                       |
| `src/client.ts`                 | Per-request Terros API client (bearer token of the caller)                 |
| `src/config.ts`                 | Environment configuration                                                  |
| `src/proxy.ts`, `src/lambda.ts` | API Gateway proxy adapter and Lambda entry point                           |
| `infra/`                        | AWS CDK app: API Gateway, Lambda, WAF, logs, Route 53 health check, alarms |

## Commands

Run from this directory:

- `pnpm test`: handler, adapter and infrastructure (CDK assertion) tests; no AWS access needed
- `pnpm typecheck`: `tsc --noEmit` over `src` and `infra`
- `pnpm build`: bundle `src/lambda.ts` and all dependencies into `dist/lambda.mjs`
- `pnpm package`: build the workspace dependencies, download the OpenAPI document, build, and copy it to `dist/terros.yml` (the Lambda asset)
- `pnpm cdk synth|diff|deploy -c stage=<staging|prod> …`: see the runbook

Deploying, DNS, Auth0 and the live client checks are done by a person: see [docs/RUNBOOK.md](docs/RUNBOOK.md).
