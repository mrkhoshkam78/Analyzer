import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@bridge': path.resolve(__dirname, 'src/bridge'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    fs: { allow: ['.'] },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
