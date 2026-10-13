import { fileURLToPath } from 'node:url'
import { defineProject } from 'vitest/config'

export default defineProject({
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@terros-inc/connect-common': fileURLToPath(new URL('../connect-common/src/index.ts', import.meta.url)),
      '@terros-inc/mcp-core': fileURLToPath(new URL('../terros-mcp-core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'infra/**/*.test.ts'],
    exclude: ['**/dist/**', '**/cdk.out/**'],
    pool: 'threads',
    testTimeout: 30000,
  },
})
