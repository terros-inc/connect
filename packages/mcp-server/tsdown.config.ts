import { defineConfig } from 'tsdown'

// One self-contained ESM file for the Lambda zip: every dependency is bundled, so the asset needs no node_modules.
export default defineConfig({
  entry: { lambda: 'src/lambda.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  dts: false,
  deps: { alwaysBundle: [/.*/], onlyBundle: false },
})
