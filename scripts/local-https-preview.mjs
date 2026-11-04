import { createServer } from 'node:https';
import { readFile, realpath } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadLocalLabPolicy } from '../backend/local-lab-policy.mjs';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

// The optional laboratory dispatches local functions without impersonating DEV.
export async function createLocalPreview({ certPath, keyPath, directory = root, localLab = false } = {}) {
  if (!certPath || !keyPath) throw Error('LOCAL_HTTPS_CERT_REQUIRED');
  if (localLab) loadLocalLabPolicy();
  const routes = [];
  if (localLab) {
    const { readdir } = await import('node:fs/promises');
    const folder = new URL('../netlify/functions/', import.meta.url);
    for (const file of await readdir(folder)) {
      if (!file.endsWith('.mjs')) continue;
      const module = await import(new URL(file, folder));
      const pattern = module.config?.path;
      if (typeof pattern !== 'string' || !pattern.startsWith('/api/v1/')) continue;
      const parts = pattern.split('/');
      routes.push({ parts, handler: module.default });
    }
    routes.sort((a, b) => a.parts.filter(p => !p.startsWith(':') && p !== '*').length < b.parts.filter(p => !p.startsWith(':') && p !== '*').length ? 1 : -1);
  }
  const [cert, key, base] = await Promise.all([readFile(certPath), readFile(keyPath), realpath(directory)]);
  const server = createServer({ cert, key }, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (!['localhost:8443', ...(localLab ? [] : ['127.0.0.1:8443'])].includes(req.headers.host)) {
        res.writeHead(403).end(); return;
      }
      if (!req.url.startsWith('/') || req.url.startsWith('//')) { res.writeHead(400).end(); return; }
      const url = new URL(req.url, 'https://localhost:8443');
      if (url.origin !== 'https://localhost:8443') { res.writeHead(400).end(); return; }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        if (!localLab) { res.writeHead(503).end('LOCAL_API_NOT_AVAILABLE'); return; }
        loadLocalLabPolicy();
        const parts = url.pathname.split('/');
        const route = routes.find(r => r.parts.every((p, i) => p === '*' ? i === r.parts.length - 1 && parts.length > i : p.startsWith(':') ? Boolean(parts[i]) : p === parts[i]) && (r.parts.at(-1) === '*' || r.parts.length === parts.length));
        if (!route) { res.writeHead(404).end(); return; }
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 2_000_000) { res.writeHead(413).end(); return; } chunks.push(chunk); }
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) if (value !== undefined && !['host', 'connection', 'content-length', 'transfer-encoding', 'forwarded', 'x-forwarded-for', 'x-real-ip'].includes(name)) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        const request = new Request(url, { method: req.method, headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) });
        const response = await route.handler(request, { ip: '127.0.0.1' });
        for (const [name, value] of response.headers) if (name !== 'set-cookie') res.setHeader(name, value);
        const cookies = response.headers.getSetCookie();
        if (cookies.length) res.setHeader('Set-Cookie', cookies);
        res.writeHead(response.status); res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
      const path = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      if (path.includes('\0') || path.split('/').some(part => part === '..' || part.startsWith('.'))) { res.writeHead(404).end(); return; }
      const target = await realpath(join(base, path));
      if (!target.startsWith(base + sep) || !types[extname(target).toLowerCase()]) { res.writeHead(404).end(); return; }
      let content = await readFile(target);
      if (localLab && extname(target).toLowerCase() === '.js') content = Buffer.from(content.toString('utf8').replaceAll('https://dev--merry-chimera-49a1f3.netlify.app', 'https://localhost:8443').replaceAll('dev--merry-chimera-49a1f3.netlify.app', 'localhost'));
      res.writeHead(200, { 'Content-Type': types[extname(target).toLowerCase()], 'Content-Length': content.length });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) { if (!res.headersSent) res.writeHead(error.code === 'ENOENT' ? 404 : 500); res.end(); }
  });
  const listen = server.listen.bind(server);
  server.listen = (port, host, callback) => {
    if (typeof port !== 'number' || host !== '127.0.0.1') throw Error('LOCAL_LOOPBACK_REQUIRED');
    return listen(port, host, callback);
  };
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw Error('LOCAL_HTTPS_CERT_REQUIRED');
    const localLab = process.env.WORKSPACE_LOCAL_LAB === 'YES';
    const server = await createLocalPreview({ certPath: process.argv[2], keyPath: process.argv[3], localLab });
    server.listen(8443, '127.0.0.1', () => console.log(localLab ? 'HTTPS laboratório: https://localhost:8443/' : 'HTTPS visual: https://localhost:8443/ — API e autenticação indisponíveis'));
  } catch { console.error('LOCAL_HTTPS_PREVIEW_UNAVAILABLE'); process.exitCode = 1; }
}