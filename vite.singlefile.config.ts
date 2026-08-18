import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The single-file artifact must be fully self-contained: strip every <link> that
// points at a sibling file (PWA manifest, apple-touch-icon) so the HTML has no
// external references at all.
function stripPwa(): Plugin {
  return {
    name: 'strip-pwa',
    transformIndexHtml(html: string): string {
      return html
        .replace(/[ \t]*<link\b[^>]*\brel=["']?manifest["']?[^>]*>\s*\n?/gi, '')
        .replace(/[ \t]*<link\b[^>]*\brel=["']?apple-touch-icon["']?[^>]*>\s*\n?/gi, '');
    },
  };
}

export default defineConfig({
  plugins: [react(), viteSingleFile(), stripPwa()],
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    'import.meta.env.VITE_SINGLEFILE': JSON.stringify('true'),
  },
  build: {
    outDir: 'dist-single',
  },
});
