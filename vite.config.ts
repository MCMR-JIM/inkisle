import { defineConfig } from 'vitest/config';
import { createReadStream, readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const pdfRoot = join(process.cwd(), 'node_modules', 'pdfjs-dist');
const resourceFolders = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];

export default defineConfig({
  plugins: [{
    name: 'local-pdf-resources',
    configureServer(server) {
      server.middlewares.use('/pdf-resources', (req, res, next) => {
        const parts = (req.url ?? '').split('?')[0].split('/').filter(Boolean);
        if (parts.length !== 2 || !resourceFolders.includes(parts[0]) || parts[1] !== basename(parts[1]) || parts[1].includes('..') || !readdirSync(join(pdfRoot, parts[0])).includes(parts[1])) return next();
        res.setHeader('Content-Type', parts[1].endsWith('.wasm') ? 'application/wasm' : parts[1].endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        createReadStream(join(pdfRoot, ...parts)).pipe(res);
      });
    },
    generateBundle() {
      for (const folder of resourceFolders) for (const name of readdirSync(join(pdfRoot, folder))) this.emitFile({ type: 'asset', fileName: `pdf-resources/${folder}/${name}`, source: readFileSync(join(pdfRoot, folder, name)) });
      this.emitFile({ type: 'asset', fileName: 'pdf-resources/LICENSE-PDFJS', source: readFileSync(join(pdfRoot, 'LICENSE')) });
      this.emitFile({ type: 'asset', fileName: 'pdf-resources/LICENSE-PDF-LIB', source: readFileSync(join(process.cwd(), 'node_modules/pdf-lib/LICENSE.md')) });
    },
  }],
  build: { target: 'es2022', assetsInlineLimit: 4096 },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
