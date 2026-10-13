import { fileURLToPath } from 'node:url'
import { defineProject } from 'vitest/config'

export default defineProject({
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@terros-inc/mcp-core': fileURLToPath(new URL('../packages/terros-mcp-core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    exclude: ['**/build/**', '**/test/__fixtures__/**'],
    pool: 'threads',
  },
})
