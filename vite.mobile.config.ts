import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: path.resolve(__dirname, 'mobile'),
  publicDir: path.resolve(__dirname, 'public/mobile'),
  plugins: [react()],
  resolve: {
    alias: {
      '/src': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5174,
    host: true,
    fs: {
      allow: [path.resolve(__dirname)],
    },
  },
  optimizeDeps: {
    exclude: ['sql.js'],
  },
  build: {
    outDir: path.resolve(__dirname, 'dist-mobile'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          sqljs: ['sql.js'],
          icons: ['lucide-react'],
        },
      },
    },
  },
});
