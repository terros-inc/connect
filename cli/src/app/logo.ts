import { extname } from 'node:path'
import { access, readFile } from 'node:fs/promises'

const CONTENT_TYPES: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

export function logoContentType(path: string): string {
  const contentType = CONTENT_TYPES[extname(path).toLowerCase()]
  if (!contentType) throw new Error(`--logo must be one of: ${Object.keys(CONTENT_TYPES).join(', ')}`)
  return contentType
}

/** Check the logo before changing the app, so a bad path fails before anything is sent. */
export async function checkLogoFile(path: string): Promise<void> {
  logoContentType(path)
  await access(path).catch(() => {
    throw new Error(`--logo file not found: ${path}`)
  })
}

/** Upload a local image to the app's `uploadAvatarUrl`, as the web developer pages do. */
export async function uploadLogo(uploadUrl: string | undefined, path: string): Promise<void> {
  if (!uploadUrl) throw new Error('The API returned no logo upload URL; you need the app:manage permission')
  const contentType = logoContentType(path)
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: await readFile(path),
    headers: { 'Content-Type': contentType },
  })
  if (!response.ok) throw new Error(`Logo upload failed: ${response.status} ${await response.text()}`)
}
