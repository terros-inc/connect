import { defineProject } from 'vitest/config'

export default defineProject({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    exclude: ['**/build/**', '**/test/__fixtures__/**'],
    pool: 'threads',
  },
})
