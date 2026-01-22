// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Allow opening the dev server from ngrok subdomains.
    // If you want to be permissive, set `true`. Otherwise list hosts explicitly.
    allowedHosts: true, // or ['.ngrok-free.app']

    proxy: {
      // App APIs
      '/api': {
        target: 'http://localhost:3050',
        changeOrigin: true,
        secure: false, // dev only
        // no rewrite → keep /api prefix
      },

      // WhatsApp webhook (keep exact path)
      '/webhook': {
        target: 'http://localhost:3050',
        changeOrigin: true,
        secure: false, // dev only
        // no rewrite → keep /webhook
     },
     server: {
      proxy: {
        '/api': { target: 'http://localhost:3050', changeOrigin: true, secure: false },
        '/savedreplys': { target: 'http://localhost:3050', changeOrigin: true, secure: false },
      }
    }
    },
  },
});
