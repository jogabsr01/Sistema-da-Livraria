import { createServer } from 'node:https';
import { readFile, realpath } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

// Visual preview only: never proxy or impersonate the published DEV origin.
export async function createLocalPreview({ certPath, keyPath, directory = root } = {}) {
  if (!certPath || !keyPath) throw Error('LOCAL_HTTPS_CERT_REQUIRED');
  const [cert, key, base] = await Promise.all([readFile(certPath), readFile(keyPath), realpath(directory)]);
  return createServer({ cert, key }, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (!['GET', 'HEAD'].includes(req.method) || !['localhost:8443', '127.0.0.1:8443'].includes(req.headers.host)) {
        res.writeHead(403).end(); return;
      }
      const url = new URL(req.url, 'https://localhost:8443');
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) { res.writeHead(503).end('LOCAL_API_NOT_AVAILABLE'); return; }
      const path = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      if (path.includes('\0') || path.split('/').some(part => part === '..' || part.startsWith('.'))) { res.writeHead(404).end(); return; }
      const target = await realpath(join(base, path));
      if (!target.startsWith(base + sep) || !types[extname(target).toLowerCase()]) { res.writeHead(404).end(); return; }
      const content = await readFile(target);
      res.writeHead(200, { 'Content-Type': types[extname(target).toLowerCase()], 'Content-Length': content.length });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch { res.writeHead(404).end(); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw Error('LOCAL_HTTPS_CERT_REQUIRED');
    const server = await createLocalPreview({ certPath: process.argv[2], keyPath: process.argv[3] });
    server.listen(8443, '127.0.0.1', () => console.log('HTTPS visual: https://localhost:8443/ — API e autenticação indisponíveis'));
  } catch { console.error('LOCAL_HTTPS_PREVIEW_UNAVAILABLE'); process.exitCode = 1; }
}