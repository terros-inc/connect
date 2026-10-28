// Presigned S3 upload URLs (for example on `company/get` for a caller who may update the company) let anyone holding
// them overwrite that avatar or icon until they expire. Only the apps' image editors need them, so the CLI drops them
// from every response rather than print them to a terminal or a script's log.
const UPLOAD_URL_KEYS = new Set(['uploadAvatarUrl', 'uploadIconUrl'])

/** The API response without presigned upload URLs, at any depth. */
export function withoutUploadUrls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUploadUrls)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !UPLOAD_URL_KEYS.has(key))
      .map(([key, entry]) => [key, withoutUploadUrls(entry)])
  )
}
