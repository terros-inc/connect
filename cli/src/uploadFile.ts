import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { UPLOAD_URL_KEYS } from '@terros-inc/mcp-core'
import type { ParsedArgs } from 'minimist'

export const UPLOAD_FILE_FLAG = 'uploadFile'

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

export type UploadFile = { field: string; path: string; contentType: string; body: Buffer }

/**
 * Split `--uploadFile <field>=<path>` off the flags and read the file, so a bad flag or file fails before the request
 * is sent.
 */
export function readUploadFile(params: ParsedArgs): { params: ParsedArgs; upload?: UploadFile } {
  const { [UPLOAD_FILE_FLAG]: value, ...rest } = params
  if (value === undefined) return { params }
  const [field, ...pathParts] = typeof value === 'string' ? value.split('=') : []
  const path = pathParts.join('=')
  if (!field || !path) throw new Error(`--${UPLOAD_FILE_FLAG} expects <field>=<path>, as in uploadAvatarUrl=logo.png`)
  if (!UPLOAD_URL_KEYS.has(field)) {
    throw new Error(`--${UPLOAD_FILE_FLAG} field must be one of ${[...UPLOAD_URL_KEYS].join(', ')}, got ${field}`)
  }
  const contentType = CONTENT_TYPES[extname(path).toLowerCase()]
  if (!contentType) throw new Error(`--${UPLOAD_FILE_FLAG} ${path} must be a PNG, JPEG or WebP image`)
  return { params: rest as ParsedArgs, upload: { field, path, contentType, body: readFileSync(path) } }
}

/**
 * PUT the file to the response's presigned URL in `upload.field`. The URL grants write access until it expires, so no
 * error here carries it: S3 error bodies and fetch causes can echo the request, and only the status is reported.
 */
export async function uploadToResponse(response: unknown, upload: UploadFile): Promise<void> {
  const urls = findStrings(response, upload.field)
  if (urls.length !== 1) {
    throw new Error(
      urls.length === 0
        ? `The request succeeded, but its response has no ${upload.field}, so ${upload.path} was not uploaded. The API returns one only to a caller who may edit the image.`
        : `The request succeeded, but its response has ${urls.length} ${upload.field} fields, so ${upload.path} was not uploaded. Narrow the request to one entity.`
    )
  }
  const result = await fetch(urls[0]!, {
    method: 'PUT',
    body: new Uint8Array(upload.body),
    headers: { 'Content-Type': upload.contentType },
    // A redirect would resend the file to wherever it points; a presigned upload URL never redirects.
    redirect: 'error',
  }).catch(() => undefined)
  if (!result?.ok) {
    const reason = result ? `HTTP ${result.status}` : 'a network error'
    throw new Error(`The request succeeded, but uploading ${upload.path} to ${upload.field} failed with ${reason}`)
  }
}

function findStrings(value: unknown, key: string): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => findStrings(item, key))
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([name, entry]) =>
    name === key && typeof entry === 'string' ? [entry] : findStrings(entry, key)
  )
}
