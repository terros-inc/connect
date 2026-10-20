import { fileURLToPath } from 'node:url'
import { defineProject } from 'vitest/config'

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineProject({
  resolve: {
    tsconfigPaths: true,
    // Tests run before CI's build step, so resolve workspace packages to their source instead of `dist`.
    alias: [
      { find: '@terros-inc/mcp-core', replacement: source('../packages/terros-mcp-core/src/index.ts') },
      { find: '@terros-inc/sdk', replacement: source('../sdk/src/index.ts') },
      {
        find: /^@terros-inc\/connect-common\/auth$/,
        replacement: source('../packages/connect-common/src/oauth/index.ts'),
      },
      { find: /^@terros-inc\/connect-common$/, replacement: source('../packages/connect-common/src/index.ts') },
    ],
  },
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    exclude: ['**/build/**', '**/test/__fixtures__/**'],
    pool: 'threads',
  },
})
