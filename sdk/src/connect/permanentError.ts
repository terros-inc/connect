/**
 * A terminal Connect AppScript failure.
 *
 * Thrown from the script Lambda, the Node.js runtime reports a `FunctionError`
 * whose `errorType` is exactly `PermanentError`. The execution engine acknowledges
 * that without an SQS retry or a dead-letter queue and logs a terminal failure.
 *
 * Throw this when the same input cannot succeed on a later run: bad config, a
 * missing location, an invalid link, or a non-retryable 4xx. Throw a normal
 * `Error` for a transient failure (timeout, network error, HTTP 429, or 5xx) so
 * the run stays retryable.
 */
export class PermanentError extends Error {
  // Lambda copies this string into FunctionError errorType.
  override readonly name: string = 'PermanentError'

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

/**
 * A terminal failure caused on the customer's side of the integration, not by Terros.
 *
 * Throw it when only the customer can fix the failure: the install's config or credentials, a payload sent to the
 * wrong script slug, or a third party rejecting the request with a non-retryable 4xx such as bad credentials. The
 * execution engine treats it as a `PermanentError` (no retry, no dead-letter queue) and counts it as an integration
 * failure, which stays visible but does not alarm Terros on-call. Every other failure counts against Terros.
 */
export class IntegrationError extends PermanentError {
  // Lambda copies this string into FunctionError errorType.
  override readonly name: string = 'IntegrationError'
}
