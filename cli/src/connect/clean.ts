import { rm } from 'node:fs/promises'
import { BUILD_DIR } from './constants.ts'

export async function cleanBuildDir(): Promise<void> {
  await rm(BUILD_DIR, { recursive: true, force: true })
}
