import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the build works at github.io/<repo>/ as well as at a root.
  base: './',
  server: { port: 5190 },
  test: { environment: 'node' },
} as never);
