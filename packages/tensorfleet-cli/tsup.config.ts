import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts'],
  format: ['cjs'],
  outDir: 'dist',
  clean: true,
  dts: true,
  sourcemap: true,
});