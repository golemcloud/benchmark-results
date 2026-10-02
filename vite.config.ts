import { defineConfig } from 'vite';

export default defineConfig({
  base: '/benchmark-results/',
  server: {
    allowedHosts: ['.onamp.dev'],
  },
});
