import { defineConfig } from 'tsdown'

// One self-contained ESM file for the Lambda zip: every dependency is bundled, so the asset needs no node_modules.
// The AWS SDK is the exception: the Lambda Node.js runtime provides it.
export default defineConfig({
  entry: { lambda: 'src/lambda.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  dts: false,
  deps: { alwaysBundle: [/^(?!@aws-sdk\/)/], neverBundle: [/^@aws-sdk\//], onlyBundle: false },
})
