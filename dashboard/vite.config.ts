import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  server: {
    port: 8973,
    host: '0.0.0.0',  // 允許 Docker 容器連接
    allowedHosts: ['host.docker.internal', 'localhost'],
    proxy: {
      '/rest': 'http://localhost:8000',
      '/auth': 'http://localhost:8000',
      '/storage': 'http://localhost:8000',
      '/realtime': {
        target: 'http://localhost:8000',
        ws: true,
      },
      '/worker': {
        target: 'http://localhost:3001',
        rewrite: (path) => path.replace(/^\/worker/, ''),
      },
    },
  },
  build: {
    outDir: 'dist/client',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
