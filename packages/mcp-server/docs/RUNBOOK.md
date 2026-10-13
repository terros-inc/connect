# Remote MCP server runbook

The steps a person does to put `@terros-inc/mcp-server` live: Auth0, DNS and certificates, deploying to staging and
prod, checking the health check, logs and alarms, and the live check with Claude and Cursor. The code, the tests and
the infrastructure definition (`infra/`) are in this package; nothing here has been run against AWS or Auth0 yet.

Do every step for **staging** first, finish the live check (step 6) there, then repeat steps 1 to 5 for **prod**.

|              | staging                                  | prod                                 |
| ------------ | ---------------------------------------- | ------------------------------------ |
| MCP URL      | `https://mcp-staging.terros.com/mcp`     | `https://mcp.terros.com/mcp`         |
| Stack        | `TerrosMcpServer-staging`                | `TerrosMcpServer-prod`               |
| Terros API   | staging API base URL (`-c apiBaseUrl=…`) | `https://api.terros.com` (default)   |
| Auth0 issuer | staging tenant (`-c auth0Issuer=…`)      | `https://auth.terros.com/` (default) |

The staging hostname is a default in `infra/stages.ts`; pass `-c domainName=…` to use another one.

## Architecture

```
Claude / Cursor ──HTTPS──▶ API Gateway custom domain (REST, regional, TLS 1.2, execute-api URL disabled)
                             │  WAF: block Host ≠ domain, block Origin not allowlisted
                             ▼
                           Lambda (Node 24, arm64): POST /mcp ─▶ fresh McpServer per request
                             │                      tool call ─▶ Terros API with the caller's bearer token
                             ▼
                           Logs: Lambda log group + API Gateway access log group
Route 53 health check ─▶ GET /health ─▶ CloudWatch alarms ─▶ SNS topic (email)
```

The stack deploys to `us-east-1`, because Route 53 health check metrics are only published there.

## 1. Auth0

Do this in the Auth0 tenant that issues logins for the target environment (prod: the tenant behind
`https://auth.terros.com`).

1. **Create an API** (Applications → APIs → Create API) for the MCP server.
   - Identifier: the MCP URL, e.g. `https://mcp-staging.terros.com/mcp`. This is the `auth0Audience` deploy value.
   - Signing algorithm: RS256. Turn on **Allow Offline Access** so clients get refresh tokens.
2. **Make the Terros API accept these tokens.** The MCP server checks that each token was issued for its own
   audience and then forwards that same token to the Terros API as `Authorization: Bearer …`, exactly as the CLI
   does with its login token. The Terros API must accept access tokens whose audience is the identifier from step 1
   (add it to the audiences the API's JWT validation accepts). Until it does, every tool call fails with the API's
   401 message while `initialize` and `tools/list` still work. Confirm this with the API owners before step 6.
3. **Let MCP clients register themselves.** Claude and Cursor use OAuth Dynamic Client Registration.
   - Tenant Settings → Advanced → enable **OIDC Dynamic Application Registration**.
   - Promote the login connection(s) users sign in with to **domain-level** connections, so dynamically registered
     applications can use them (Authentication → the connection → enable for third-party apps).
   - If DCR is not acceptable, create one application per client instead and enter its client ID (and secret) in the
     client's advanced connector settings; the callback URLs are in step 6.
4. **Accept the `resource` parameter.** MCP clients send RFC 8707 `resource=<MCP URL>` instead of Auth0's
   `audience`. Tenant Settings → Advanced → enable **Resource Parameter Compatibility Profile**, so the token is
   issued as a JWT for the API from step 1 rather than an opaque token. Without it the server answers `401`.
5. Check discovery from a shell (no secrets involved):
   ```sh
   curl -s https://auth.terros.com/.well-known/openid-configuration | jq '.issuer, .registration_endpoint'
   ```
   The issuer, including its trailing slash, is the `auth0Issuer` deploy value. The MCP server advertises
   `<issuer>authorize`, `<issuer>oauth/token` and `<issuer>oidc/register` in its own
   `/.well-known/oauth-authorization-server`; they must match what Auth0 reports here.

## 2. DNS and certificate

Pick one, per stage.

**A. `terros.com` is a Route 53 hosted zone in the deploy account.** Pass `-c hostedZoneId=<zone id>
-c zoneName=terros.com`. The stack creates the ACM certificate (DNS-validated in that zone) and the alias `A`
record. Nothing else to do.

**B. DNS is managed elsewhere.**

1. In ACM in `us-east-1`, request a public certificate for the stage's hostname with DNS validation, add the
   validation `CNAME` record at the DNS provider, and wait for the status **Issued**.
2. Deploy with `-c certificateArn=<certificate ARN>` (step 3).
3. Create a `CNAME` from the hostname to the stack output `DomainTarget` (a `d-….execute-api.us-east-1.amazonaws.com`
   name). If the record is proxied by a CDN, turn proxying off: the gateway only answers its own Host and SNI.

## 3. Deploy

Prerequisites: AWS credentials for the target account in the shell, Node 24, `pnpm install --frozen-lockfile` at the
repository root, and `wget`. Bootstrap CDK once per account: `pnpm cdk bootstrap aws://<account>/us-east-1`.

From `packages/mcp-server`:

```sh
pnpm package   # builds workspace dependencies, then dist/lambda.mjs + dist/terros.yml

# staging
pnpm cdk diff   -c stage=staging -c apiBaseUrl=<staging API URL> -c auth0Issuer=<staging issuer>/ \
                -c auth0Audience=https://mcp-staging.terros.com/mcp \
                -c alarmEmail=<on-call list> <DNS option: -c hostedZoneId=… -c zoneName=… | -c certificateArn=…>
pnpm cdk deploy …same arguments…

# prod (after step 6 passed on staging)
pnpm cdk deploy -c stage=prod -c auth0Audience=https://mcp.terros.com/mcp -c alarmEmail=<on-call list> <DNS option>
```

Other context values: `-c allowedOrigins=host1,host2` adds browser origins (hostnames) to the allowlist; the server's
own hostname is always allowed and requests without an `Origin` header (Claude, Cursor) are not affected.
`-c domainName=…` overrides the hostname. Prefer recording the final values in `cdk.json` `context` (non-secret
only) in a follow-up commit, so later deploys repeat them.

The deploy prints the outputs `McpUrl`, `DomainTarget`, `FunctionLogGroup`, `AccessLogGroup`, `HealthCheckId` and
`AlarmTopicArn`. Nothing secret is configured: the server holds no API key or client secret.

## 4. Smoke checks after each deploy

Replace `$HOST` with the stage hostname.

```sh
curl -si https://$HOST/health                         # 200 {"status":"ok","version":"…"}
curl -si https://$HOST/mcp                            # 405, Allow: POST, JSON-RPC error body
curl -si -X DELETE https://$HOST/mcp                  # 405
curl -si -X POST https://$HOST/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
                                                      # 401, WWW-Authenticate: Bearer … resource_metadata="https://$HOST/.well-known/oauth-protected-resource/mcp"
curl -s https://$HOST/.well-known/oauth-protected-resource/mcp
                                                      # {"resource":"https://$HOST/mcp","authorization_servers":["<issuer>"],…}
curl -si -X POST https://$HOST/mcp -H 'origin: https://evil.example.test' -d '{}'
                                                      # 403 from WAF (gateway origin protection)
```

The Host protection is enforced three times: API Gateway only routes the custom domain (the `execute-api` URL is
disabled), WAF blocks any other `Host`, and the handler rejects it again. To see the WAF rule fire, send a request to
the regional endpoint with a wrong Host: `curl -sk https://<DomainTarget>/health -H 'host: evil.example.test'`
should not reach the function (403).

## 5. Health check, logs and alarms

- **Health check:** Route 53 → Health checks → `terros-mcp-<stage>` should be **Healthy** within a few minutes.
- **Logs:**
  ```sh
  aws logs tail <FunctionLogGroup> --follow --region us-east-1   # one JSON line per request: requestId, method, path, status, durationMs
  aws logs tail <AccessLogGroup> --follow --region us-east-1     # API Gateway access log
  ```
  Neither log contains headers, tokens or request bodies; keep it that way.
- **Alarms:** confirm the SNS subscription email sent to `alarmEmail`. In CloudWatch → Alarms, these should be
  `OK` (or `Insufficient data` before traffic): `terros-mcp-<stage>-HealthCheckFailing`, `-FunctionErrors`,
  `-FunctionThrottles`, `-Api5xx`, `-ApiLatencyP95`. Test the notification path once:
  ```sh
  aws cloudwatch set-alarm-state --region us-east-1 --alarm-name terros-mcp-<stage>-Api5xx \
    --state-value ALARM --state-reason "runbook notification test"
  ```
  The email should arrive, and the alarm returns to `OK` on its next evaluation.
- WAF: the web ACL metrics `terros-mcp-<stage>-unexpected-host` and `-disallowed-origin` count blocked requests.

## 6. Live check with Claude and Cursor (staging)

Use a staging Terros user without access to real customer data.

**Claude** (claude.ai, Settings → Connectors → Add custom connector):

1. Name `Terros staging`, URL `https://mcp-staging.terros.com/mcp`. If Auth0 DCR is off, open the advanced settings
   and enter the client ID created for Claude (its callback URL is `https://claude.ai/api/mcp/auth_callback`;
   check Anthropic's current connector docs if it fails).
2. Connect, sign in through the Auth0 page, and approve.
3. In a chat with the connector enabled, ask for a harmless read, e.g. "Use Terros to show my user profile". The
   tool call should succeed and return data for the signed-in user.

**Cursor** (Settings → MCP → Add, or `~/.cursor/mcp.json`):

```json
{ "mcpServers": { "terros-staging": { "url": "https://mcp-staging.terros.com/mcp" } } }
```

1. Cursor shows the server as needing login; click **Login** and finish the Auth0 sign-in (pre-registered client
   callback: `cursor://anysphere.cursor-mcp/oauth/callback`).
2. The tool list should show the Terros tools (e.g. `user_profile`, `account_get`). Ask the agent to run a read-only one.

**Check per user:** sign in as a second staging user in another client and confirm each sees only their own data.
While testing, `aws logs tail <FunctionLogGroup>` should show `POST /mcp` lines with status 200 and no 5xx.

Record the outcome (client, date, user, tool called, result) on the issue. Then deploy prod (step 3) and repeat steps
4 and 5 there.

## Rollback and removal

- Roll back by checking out the previous commit and running `pnpm package` and `pnpm cdk deploy` with the same
  arguments. The function is stateless, so there is nothing to migrate.
- Staging can be removed with `pnpm cdk destroy -c stage=staging …`. Prod log groups are retained on removal.

## Troubleshooting

| Symptom                                                                  | Likely cause                                                                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Client loops on login, server logs `401`                                 | Token audience is not `auth0Audience`, or an opaque token (enable the Resource Parameter Compatibility Profile, step 1.4) |
| `initialize` works, every tool call errors with an authorization message | The Terros API does not accept the MCP audience yet (step 1.2)                                                            |
| `403 Invalid Host` / WAF blocks                                          | Request did not use the custom domain, or a CDN rewrote `Host`                                                            |
| `403 Invalid Origin`                                                     | A browser client's origin is not in `-c allowedOrigins`                                                                   |
| Health check alarm, `/health` fine by hand                               | DNS or certificate mismatch seen from Route 53 checkers; check the record and certificate                                 |
| `TERROS_API_KEY must not be set` in the function log                     | Someone added a server-wide key; remove it. Each request must use its caller's token                                      |
