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
  override readonly name = 'PermanentError'

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}
