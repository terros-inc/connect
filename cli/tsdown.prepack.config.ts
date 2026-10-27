import { defineConfig } from 'tsdown'

// Bundles the release schema check for `prepack`, outside `dist` so it is not published.
export default defineConfig({
  entry: 'src/prepack.ts',
  outDir: '.prepack',
  dts: false,
  exports: false,
})
