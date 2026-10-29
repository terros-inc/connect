# Terros SDK

Typescript SDK & API client interface for the Terros Sales platform.

## Requirements

- Node.js 24 or newer
- A Terros API key with access to the platform

## PermanentError

Throw `PermanentError` from a Connect script when the same input cannot succeed on a later run: bad config, a missing location, an invalid link, or a non-retryable 4xx. The Node.js Lambda runtime reports that thrown error as a `FunctionError` with `errorType` `PermanentError`. The execution engine acknowledges it without retrying or sending it to a dead-letter queue, and logs a terminal failure.

Throw a normal `Error` for a transient failure, such as a timeout, a network error, HTTP 429, or a 5xx. Those stay retryable.

```ts
import { PermanentError, wrapConnectHandler } from '@terros-inc/sdk'

export const handler = wrapConnectHandler(async (input) => {
  const locationId = input.context.config.scriptConfig.locationId
  if (!locationId) throw new PermanentError('scriptConfig.locationId is required')
})
```
