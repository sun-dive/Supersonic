import { build } from 'esbuild'

await build({
  entryPoints: ['src/app.ts'],
  bundle: true,
  outfile: 'bundle.js',
  platform: 'browser',
  format: 'iife',
  sourcemap: true,
  target: 'es2020',
  define: {
    'global': 'window',
  },
})

console.log('Build complete: bundle.js')
