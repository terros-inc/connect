import { fileURLToPath } from 'node:url'
import { defineProject } from 'vitest/config'

// Tests load the SDK from source rather than sdk/dist, which other packages' pretests rebuild (and clean) while
// `pnpm -r test` runs this package's tests.
const source = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineProject({
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@terros-inc/sdk': source('../../sdk/src/index.ts'),
      '@terros-inc/connect-common': source('../../packages/connect-common/src/index.ts'),
    },
  },
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    exclude: ['**/build/**', '**/test/__fixtures__/**'],
    pool: 'threads',
    passWithNoTests: true,
  },
})
