# Terros SDK

TypeScript SDK and API client for the Terros Sales platform, and the runtime helpers for Terros Connect scripts.

The [Terros Connect guide](https://docs.terros.com/docs/info/connect) covers how to create an app, write and publish scripts, and install them.

## Requirements

- Node.js 24
- A Terros API key, or a `terros auth login` sign-in from the [CLI](../cli/README.md). A Connect script needs neither: Terros passes it a key.

## Connect Scripts

Wrap a script's function in `wrapConnectHandler` and export it as `handler`:

```ts
import { wrapConnectHandler, type AccountWebhook, type CustomFieldId } from '@terros-inc/sdk'

type ScriptConfig = { fieldId: CustomFieldId; value: string }

export const handler = wrapConnectHandler<AccountWebhook, void, ScriptConfig>(async (input, client) => {
  const { payload, config } = input.context
  if (payload.action === 'remove') return
  const { fieldId, value } = config.scriptConfig
  // The update below is itself an account change, which runs this script again.
  if (payload.data.customFieldMap?.[fieldId] === value) return
  await client.account.update({ account: { accountId: payload.data.id, customFieldsPatch: { [fieldId]: value } } })
})
```

The function gets:

- `input.runId`: the run's ID, `ConnectRun.<id>`
- `input.context.payload`: what triggered the run
- `input.context.config.scriptConfig`: the install's values for the script's config fields
- `input.context.config.secrets`: the install's values for the secrets in the script's `authSchema`
- `client`: a `TerrosClient` signed in with the key Terros passed for this run. `wrapConnectHandler` removes that key from `input` before your function runs.

## TerrosClient

`new TerrosClient()` groups API calls by resource: `account`, `account.status`, `apiHistory`, `area`, `calendar`, `calendar.event`, `company`, `connect`, `plan`, `team` and `user`. Each method posts its input to the API path of the same name, so `client.account.upsert(input)` calls `/account/upsert`, and returns the response. `plan` methods always send `version: 2`, the API's stage-based plan shape; plans exist only for weeks and quarters (`PLAN_PERIOD_TYPES`). The [API reference](https://docs.terros.com) documents each path's fields.

A failed call throws. When the API answers with an error, the thrown error's `name` is `TerrosApiError` and its `code` is the API's error code, such as `NotFound`.

Constructor options: `apiKey`, `authType` (`ApiKey`, the default, or `ConnectKey`), `baseUrl` and `impersonateUserId`. With no `apiKey`, the client uses the key from the environment (below), then the CLI's saved sign-in.

## Backend Host and Keys

The client picks its host from `TERROS_ENV` (or `TERROS_API_ENDPOINT`), defaulting to `https://api.terros.com`; a `baseUrl` overrides both. It accepts a `baseUrl` only on `https://api.terros.com`, `https://api.<stage>.terros.com` or `http://localhost[:port]`, with no path prefix, port (except on localhost), credentials or query. Anything else throws when the client is constructed, so a key is never sent to another host. When no key is passed, production reads `TERROS_API_KEY` and any other environment reads `TERROS_API_KEY_STAGE_<NAME>` (name upper-cased, hyphens as underscores; `TERROS_API_KEY_PORT_<port>` for localhost).

## PermanentError

Throw `PermanentError` from a Connect script when the same input cannot succeed on a later run: bad config, a missing location, an invalid link, or a non-retryable 4xx. The Node.js Lambda runtime reports that thrown error as a `FunctionError` with `errorType` `PermanentError`. The execution engine acknowledges it without retrying or sending it to a dead-letter queue, and logs a terminal failure.

Throw a normal `Error` for a transient failure, such as a timeout, a network error, HTTP 429, or a 5xx. The engine logs it as a failed run. It does not retry failed runs today, so write scripts that are safe to run again for the same record.

```ts
import { PermanentError, wrapConnectHandler } from '@terros-inc/sdk'

export const handler = wrapConnectHandler(async (input) => {
  const locationId = input.context.config.scriptConfig.locationId
  if (!locationId) throw new PermanentError('scriptConfig.locationId is required')
})
```

### IntegrationError

`IntegrationError` is a `PermanentError` the customer's side caused, so only the customer can fix it: the install's config or credentials, a payload sent to the wrong script slug, or a third party rejecting the request with a non-retryable 4xx such as bad credentials. It is not retried either, and the execution engine counts it as an integration failure: it stays visible in the run's logs and metrics but does not alarm Terros. Every other failure, a `PermanentError` or a plain `Error` included, counts as a Terros failure, so throw `IntegrationError` only when you know the cause is on the customer's side.

```ts
if (response.status === 400) throw new IntegrationError('The third party rejected the install credentials')
```
