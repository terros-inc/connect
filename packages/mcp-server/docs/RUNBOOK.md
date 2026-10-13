# Remote MCP server runbook

The steps a person does to put `@terros-inc/mcp-server` live: Auth0, DNS and certificates, deploying to staging and
prod, checking the health check, logs and alarms, and the live check with Claude and Cursor. The code, the tests and
the infrastructure definition (`infra/`) are in this package; nothing here has been run against AWS or Auth0 yet.

Do every step for **staging** first, finish the live check (step 6) there, then repeat steps 1 to 5 for **prod**.

|              | staging                                  | prod                                 |
| ------------ | ---------------------------------------- | ------------------------------------ |
| MCP URL      | `https://mcp.staging.terros.com`         | `https://mcp.terros.com`             |
| Stack        | `TerrosMcpServer-staging`                | `TerrosMcpServer-prod`               |
| Terros API   | staging API base URL (`-c apiBaseUrl=…`) | `https://api.terros.com` (default)   |
| Auth0 issuer | staging tenant (`-c auth0Issuer=…`)      | `https://auth.terros.com/` (default) |

The MCP server is served at the root of its hostname: there is no `/mcp` path and no alias. The MCP URL is also the
OAuth resource and the Auth0 audience of the tokens clients present. Both hostnames are per-stage defaults in
`infra/stages.ts` (`-c domainName=…` overrides one); nothing in the server code names a hostname.

## Architecture

```
Claude / Cursor ──HTTPS──▶ API Gateway custom domain (REST, regional, TLS 1.2, execute-api URL disabled)
                             │  WAF: block Host ≠ domain, block Origin not allowlisted
                             ▼
                           Lambda (Node 24, arm64): POST / ─▶ verify token (audience = MCP URL)
                             │                                ─▶ fresh McpServer per request
                             │                      tool call ─▶ Auth0 token exchange: MCP token → Terros API token
                             │                                ─▶ Terros API with the exchanged token (same user)
                             ▼
                           Logs: Lambda log group + API Gateway access log group
Route 53 health check ─▶ GET /health ─▶ CloudWatch alarms ─▶ SNS topic (email)
```

The stack deploys to `us-east-1`, because Route 53 health check metrics are only published there.

API Gateway REST integrations time out after **29 seconds** (the Lambda timeout matches). A tool call whose Terros API
request, plus the token exchange, takes longer fails with a gateway `504`. Raising it needs an AWS service quota
increase for the account's integration timeout and a matching change in `infra/stack.ts`.

**No token passthrough.** The token a client presents is issued for the MCP server (audience = the MCP URL) and is
never sent to the Terros API. On the first Terros API call of a request, the server exchanges it at Auth0 (RFC 8693
Custom Token Exchange, steps 1.7 to 1.10) for a token issued for the Terros API's own audience, for the same user, and calls
the API with that. Requests that call no tool (`initialize`, `tools/list`) cost no exchange. Nothing is cached
between requests.

## 1. Auth0

Custom Token Exchange is available on Terros's Auth0 Enterprise Agreement. Do these steps once per stage, staging
first. Values per stage:

|                                      | staging                                                                         | prod                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Tenant                               | the tenant behind the staging issuer (see "Tenants" below)                      | the tenant behind `https://auth.terros.com/`                              |
| MCP API identifier (step 1.1)        | `https://mcp.staging.terros.com`                                                | `https://mcp.terros.com`                                                  |
| M2M application (step 1.9)           | `Terros MCP server (staging)`                                                   | `Terros MCP server (prod)`                                                |
| Client secret in AWS Secrets Manager | `terros-mcp/staging/auth0-token-exchange` (staging deploy account, `us-east-1`) | `terros-mcp/prod/auth0-token-exchange` (prod deploy account, `us-east-1`) |

**Tenants.** If staging logins come from the same tenant as prod (issuer `https://auth.terros.com/`), both MCP APIs
and both M2M applications live in that one tenant, and tenant-wide steps (1.3, 1.4, 1.5, 1.7, 1.8, 1.11) are done once
and shared: there is one Action and one token exchange profile, whose `MCP_AUDIENCES` secret lists both stages. If
staging is a separate Auth0 tenant, do every step in each tenant; each tenant's Action lists only its own stage, and
staging's issuer is the `auth0Issuer` staging deploy value. The issuer is whatever step 1.12 prints for that tenant.

**No scopes, no RBAC.** Terros does not put permissions in OAuth scopes. On the MCP APIs (step 1.1) do not enable
RBAC or **Add Permissions in the Access Token**, and define no permissions. The server neither advertises nor checks
scopes (its `401` challenge and protected resource metadata carry none). What a user may do is decided by the
existing permission checks of `api.terros.com` for the user of the exchanged token. Leave the Terros API's own
settings (step 1.2) as they are, apart from the consent setting named there.

1. **Create the MCP API** (Applications → APIs → Create API), one per stage.
   - Name `Terros MCP (<stage>)`. Identifier: exactly the stage's MCP URL from the table, with no path and no trailing
     slash. The server derives its audience from its own URL, so there is no separate audience setting; if the
     identifier differs (for example `https://mcp.terros.com/` or `…/mcp`), every login ends in `401`.
   - Signing algorithm: RS256.
   - Settings: **RBAC off**, **Add Permissions in the Access Token off**; **Allow Offline Access on**, so a client
     that asks Auth0 for `offline_access` (listed in Auth0's own metadata, not by the server) gets a refresh token;
     **Allow Skipping User Consent** may stay off (the MCP clients are third-party and show consent).
   - Permissions tab: leave empty.
2. **Find the Terros API's identifier** (Applications → APIs → the API that `api.terros.com` validates tokens for, in
   the stage's tenant). It is the `apiAudience` deploy value. On that API, **Allow Skipping User Consent** must be on:
   token exchange is non-interactive, so Auth0 cannot ask for consent. Change nothing else; the Terros API only ever
   receives tokens issued for its own audience.
3. **Accept the `resource` parameter.** MCP clients send RFC 8707 `resource=<MCP URL>` instead of Auth0's `audience`.
   Settings → Advanced → enable **Resource Parameter Compatibility Profile**, so the token is issued as a JWT for the
   API from step 1.1 rather than an opaque token. Without it the server answers `401`.
4. **Enable Dynamic Client Registration.** Claude, ChatGPT and Cursor register themselves as OAuth clients (RFC 7591).
   Settings → Advanced → enable **Dynamic Client Registration (DCR)**, or with the Management API:
   ```sh
   curl -s -X PATCH "https://<tenant domain>/api/v2/tenants/settings" \
     -H "authorization: Bearer $MGMT_TOKEN" -H 'content-type: application/json' \
     -d '{"flags":{"enable_dynamic_client_registration":true}}'
   ```
   Dynamically registered applications are third-party: users see a consent screen on first sign-in. The
   registration endpoint is open, so watch Applications for unexpected registrations; Auth0's tenant logs record them.
   If DCR is not acceptable, create one Regular Web Application per client by hand, add the callback URLs of step
   1.6, and enter its client ID and secret in the client's advanced connector settings.
5. **Make the login connection domain-level.** Third-party (DCR) applications can only use domain-level connections.
   For each connection Terros users sign in with (Authentication → Database / Social / Enterprise; note its ID
   `con_…`):
   ```sh
   curl -s -X PATCH "https://<tenant domain>/api/v2/connections/<connection ID>" \
     -H "authorization: Bearer $MGMT_TOKEN" -H 'content-type: application/json' \
     -d '{"is_domain_connection":true}'
   ```
   In the dashboard this is the connection's **Promote Connection to Domain Level** setting.
6. **Allowed callback URLs.** With DCR each client registers its own redirect URI, and Auth0 stores it as that
   application's allowed callback URL, so nothing needs adding. Check after the live check (step 6) that the
   registered applications carry these URLs, and add them by hand to any application created without DCR (checked
   against the vendors' docs on 2026-10-13; recheck if a login fails with a callback mismatch):

   | Client                                         | Callback URL                                                                                                                                                 |
   | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | Claude (claude.ai web, Claude Desktop, mobile) | `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback` (Anthropic asks to allow both)                                      |
   | Claude Code                                    | loopback `http://localhost:<port>/callback` and `http://127.0.0.1:<port>/callback`, any port                                                                 |
   | ChatGPT                                        | the per-app `https://chatgpt.com/connector/oauth/<callback id>` shown while creating the app; legacy `https://chatgpt.com/connector_platform_oauth_redirect` |
   | Cursor                                         | `cursor://anysphere.cursor-mcp/oauth/callback`                                                                                                               |

   Claude Desktop uses the same connector as claude.ai (Settings → Connectors) and the same callback.

7. **Create the Custom Token Exchange Action** (Actions → Library → Create Action → Build from scratch, trigger
   **Custom Token Exchange**), named `terros-mcp-token-exchange`. Add the dependency `jose` (a 4.x version, which
   ships CommonJS for `require`) and two secrets:
   - `ISSUER`: the tenant's issuer from step 1.12, with its trailing slash.
   - `MCP_AUDIENCES`: JSON mapping each stage's M2M client ID (step 1.9) to that stage's MCP API identifier, e.g.
     `{"<prod client ID>":"https://mcp.terros.com","<staging client ID>":"https://mcp.staging.terros.com"}` in a shared
     tenant, or one entry in a stage's own tenant. Create the Action with a placeholder, and fill this in after step
     1.9.

   ```js
   const { createRemoteJWKSet, jwtVerify } = require('jose')

   exports.onExecuteCustomTokenExchange = async (event, api) => {
     // Each stage's MCP server may only exchange tokens issued for its own MCP API.
     const audience = JSON.parse(event.secrets.MCP_AUDIENCES)[event.client.client_id]
     if (!audience) {
       api.access.deny('unauthorized_client', 'This client may not exchange MCP tokens')
       return
     }
     const jwks = createRemoteJWKSet(new URL('.well-known/jwks.json', event.secrets.ISSUER))
     let payload
     try {
       ;({ payload } = await jwtVerify(event.transaction.subject_token, jwks, {
         issuer: event.secrets.ISSUER,
         audience,
         algorithms: ['RS256'],
         requiredClaims: ['exp', 'sub'],
       }))
     } catch {
       api.access.rejectInvalidSubjectToken('Invalid subject_token')
       return
     }
     // Only user logins; a client-credentials token (sub "…@clients") has no user to act for.
     if (payload.sub.endsWith('@clients')) {
       api.access.deny('invalid_request', 'The subject token has no user')
       return
     }
     api.authentication.setUserById(payload.sub)
   }
   ```

   Deploy it and note its ID (shown in the Action's URL). The Action sets no scopes or permissions.

8. **Create the token exchange profile** that routes the server's exchanges to the Action, once per tenant, with the
   Management API (a Management API token with the `create:token_exchange_profiles` scope, e.g. from the API
   Explorer):
   ```sh
   curl -s -X POST "https://<tenant domain>/api/v2/token-exchange-profiles" \
     -H "authorization: Bearer $MGMT_TOKEN" -H 'content-type: application/json' \
     -d '{"name":"terros-mcp","subject_token_type":"https://terros.com/token-types/mcp-access-token",
          "action_id":"<Action ID>","type":"custom_authentication"}'
   ```
   The `subject_token_type` must be exactly this value: the server sends it (`src/exchange.ts`). A tenant allows one
   profile per `subject_token_type`, which is why a shared tenant has one profile and one Action for both stages.
9. **Create the M2M application** the MCP server uses for the exchange, one per stage. It is a first-party,
   OIDC-conformant Machine to Machine (`non_interactive`) application that authenticates with `client_secret_post`
   (the server sends its client ID and secret in the token request body). Create it with the Management API, so it
   gets no client-credentials grant to any API (the server never uses client credentials):
   ```sh
   curl -s -X POST "https://<tenant domain>/api/v2/clients" \
     -H "authorization: Bearer $MGMT_TOKEN" -H 'content-type: application/json' \
     -d '{"name":"Terros MCP server (<stage>)","app_type":"non_interactive","is_first_party":true,
          "oidc_conformant":true,"token_endpoint_auth_method":"client_secret_post"}'
   curl -s -X PATCH "https://<tenant domain>/api/v2/clients/<client ID>" \
     -H "authorization: Bearer $MGMT_TOKEN" -H 'content-type: application/json' \
     -d '{"token_exchange":{"allow_any_profile_of_type":["custom_authentication"]}}'
   ```
   (In the dashboard: Applications → Create Application → **Machine to Machine Applications**. If it insists on
   authorizing an API, pick none or delete that grant afterwards under the application's **APIs** tab, and grant it
   no permissions.) If the Terros API restricts which applications may get user tokens (its **Application Access** /
   user access policy), allow this application. Its client ID is the `tokenExchangeClientId` deploy value; add it to
   the Action's `MCP_AUDIENCES` (step 1.7).
10. **Store the M2M client secret in AWS Secrets Manager** in the stage's deploy account, `us-east-1`, as a plain-text
    secret named as in the table above (the stack's default; `-c tokenExchangeSecretName=…` overrides it). Paste the
    secret in the console, or read it from a file so it stays out of shell history:
    ```sh
    aws secretsmanager create-secret --region us-east-1 --name terros-mcp/<stage>/auth0-token-exchange \
      --secret-string file://client-secret.txt && rm client-secret.txt
    ```
    The Lambda gets read access to this one secret and reads it on its first token exchange. To rotate, rotate the
    secret in Auth0, update the Secrets Manager value, and redeploy (or wait for new Lambda containers). Never put it
    in `cdk.json`, `-c` arguments or the repository.
11. **Attack Protection:** failed exchanges count towards **Suspicious IP Throttling**, and every exchange comes from
    the Lambda's few egress IPs. The server only exchanges tokens it has already verified, so failures should be rare;
    if tool calls start failing with `429`/`too_many_attempts`, check Security → Attack Protection and the tenant logs
    (`fecte` = failed exchange, `secte` = successful).
12. **Check discovery** from a shell (no secrets involved), with the tenant's login domain:
    ```sh
    curl -s https://auth.terros.com/.well-known/openid-configuration | jq '.issuer, .registration_endpoint'
    ```
    The issuer, including its trailing slash, is the `auth0Issuer` deploy value and the Action's `ISSUER`;
    `registration_endpoint` is present once DCR is on. The MCP server's protected resource metadata names this issuer,
    and clients read the authorization server metadata (authorize, token and register endpoints) from Auth0 directly;
    the server does not copy it.

## 2. DNS and certificate

Pick one, per stage.

**A. `terros.com` is a Route 53 hosted zone in the deploy account.** Pass `-c hostedZoneId=<zone id>
-c zoneName=terros.com`. The stack creates the ACM certificate (DNS-validated in that zone) and the alias `A`
record. Nothing else to do. For staging, if `staging.terros.com` is its own (delegated) hosted zone, pass that
zone instead: `-c zoneName=staging.terros.com` with its zone ID.

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
                -c apiAudience=<Terros API identifier, step 1.2> -c tokenExchangeClientId=<M2M client ID, step 1.9> \
                -c alarmEmail=<on-call list> <DNS option: -c hostedZoneId=… -c zoneName=… | -c certificateArn=…>
pnpm cdk deploy …same arguments…

# prod (after step 6 passed on staging)
pnpm cdk deploy -c stage=prod -c apiAudience=<Terros API identifier> -c tokenExchangeClientId=<M2M client ID> \
                -c alarmEmail=<on-call list> <DNS option>
```

The MCP URL (and with it the token audience) is always `https://<domainName>`; there is no audience setting.

Other context values: `-c allowedOrigins=host1,host2` adds browser origins (hostnames) to the allowlist; the server's
own hostname is always allowed and requests without an `Origin` header (Claude, Cursor) are not affected.
`-c domainName=…` overrides the hostname. Prefer recording the final values in `cdk.json` `context` (non-secret
only) in a follow-up commit, so later deploys repeat them.

The deploy prints the outputs `McpUrl`, `DomainTarget`, `FunctionLogGroup`, `AccessLogGroup`, `HealthCheckId` and
`AlarmTopicArn`. The only secret is the token exchange client secret, read at runtime from Secrets Manager (step
1.10); the server holds no Terros API key.

## 4. Smoke checks after each deploy

Replace `$HOST` with the stage hostname.

```sh
curl -si https://$HOST/health                         # 200 {"status":"ok","version":"…"}
curl -si https://$HOST/                               # 405, Allow: POST, JSON-RPC error body
curl -si -X DELETE https://$HOST/                     # 405
curl -si -X POST https://$HOST/ -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
                                                      # 401, WWW-Authenticate: Bearer … resource_metadata="https://$HOST/.well-known/oauth-protected-resource"
curl -s https://$HOST/.well-known/oauth-protected-resource
                                                      # {"resource":"https://$HOST","authorization_servers":["<issuer>"],"bearer_methods_supported":["header"],…} (no scopes)
curl -si -X POST https://$HOST/mcp                    # 404: there is no /mcp path
curl -si -X POST https://$HOST/ -H 'origin: https://evil.example.test' -d '{}'
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

## 6. Live check with Claude, ChatGPT and Cursor (staging)

Use a staging Terros user without access to real customer data. The connector URL is the bare origin,
`https://mcp.staging.terros.com` (prod: `https://mcp.terros.com`), with no path.

**OAuth callback URLs** for Claude, ChatGPT and Cursor are listed in step 1.6. With DCR (step 1.4) each
client registers its own; afterwards check that the registered applications carry them.

**Claude** (claude.ai or Claude Desktop, Settings → Connectors → Add custom connector):

1. Name `Terros staging`, URL `https://mcp.staging.terros.com`. If Auth0 DCR is off, open the advanced settings and
   enter the client ID created for Claude.
2. Connect, sign in through the Auth0 page, and approve.
3. In a chat with the connector enabled, ask for a harmless read, e.g. "Use Terros to show my user profile". The
   tool call should succeed and return data for the signed-in user.

**ChatGPT** (Settings → Apps & Connectors → Advanced → developer mode, then Create): URL
`https://mcp.staging.terros.com`, authentication OAuth. Sign in, then ask for the same harmless read.

**Cursor** (Settings → MCP → Add, or `~/.cursor/mcp.json`):

```json
{ "mcpServers": { "terros-staging": { "url": "https://mcp.staging.terros.com" } } }
```

1. Cursor shows the server as needing login; click **Login** and finish the Auth0 sign-in.
2. The tool list should show the Terros tools (e.g. `user_profile`, `account_get`). Ask the agent to run a read-only one.

**Check per user:** sign in as a second staging user in another client and confirm each sees only their own data.
While testing, `aws logs tail <FunctionLogGroup>` should show `POST /` lines with status 200 and no 5xx, and the
Auth0 tenant logs should show one `secte` (successful token exchange) per tool-calling request.

Record the outcome (client, date, user, tool called, result) on the issue. Then deploy prod (step 3) and repeat steps
4 and 5 there.

## Rollback and removal

- Roll back by checking out the previous commit and running `pnpm package` and `pnpm cdk deploy` with the same
  arguments. The function is stateless, so there is nothing to migrate.
- Staging can be removed with `pnpm cdk destroy -c stage=staging …`. Prod log groups are retained on removal.

## Troubleshooting

| Symptom                                                                 | Likely cause                                                                                                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client loops on login, server logs `401`                                | The Auth0 API identifier is not exactly the MCP URL (step 1.1), or an opaque token (enable the Resource Parameter Compatibility Profile, step 1.3) |
| Tool calls fail with `Terros API authorization failed (…)`              | The token exchange was refused; the reason is in the message and in the Auth0 `fecte` log (steps 1.7 to 1.9)                                       |
| Tool calls fail with `AccessDeniedException` / secret errors in the log | The Secrets Manager secret is missing, empty or named differently from `tokenExchangeSecretName` (step 1.10)                                       |
| Tool calls fail with the Terros API's 401 message                       | `apiAudience` is not the identifier the Terros API validates (step 1.2), or the M2M application lacks access to that API (step 1.9)                |
| `403 Invalid Host` / WAF blocks                                         | Request did not use the custom domain, or a CDN rewrote `Host`                                                                                     |
| `403 Invalid Origin`                                                    | A browser client's origin is not in `-c allowedOrigins`                                                                                            |
| Health check alarm, `/health` fine by hand                              | DNS or certificate mismatch seen from Route 53 checkers; check the record and certificate                                                          |
| `TERROS_API_KEY must not be set` in the function log                    | Someone added a server-wide key; remove it. Each request must use its caller's token                                                               |
