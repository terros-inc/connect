// A failure that cannot succeed on a later run with the same input: bad config or credentials, a malformed job
// link, a ServiceTitan 4xx or invalid response, or an ambiguous create. The entrypoint logs it and returns normally,
// so a platform redelivery (if one is ever added for thrown scripts) does not replay it. Other errors are rethrown.
export class PermanentError extends Error {
  override name = 'PermanentError'
}
