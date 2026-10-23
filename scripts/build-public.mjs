import { mkdir, copyFile, rm, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export async function build(root = fileURLToPath(new URL('../', import.meta.url))) {
  const destination = resolve(root, 'dist');
  const stat = await lstat(destination).catch(e => { if (e.code !== 'ENOENT') throw e; });
  if (stat?.isSymbolicLink()) throw new Error('dist must not be a symlink');
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination);
  // Explicit allowlist: backend, Apps Script, tests and configuration are never published.
  for (const file of ['index.html', 'teste-dev.txt', 'acesso-dev.html', 'acesso-dev.js', 'acesso-dev.css', 'catalogo-dev.html', 'catalogo-dev.js', 'catalogo-dev.css']) {
    const input = resolve(root, file);
    const info = await lstat(input).catch(e => { if (e.code !== 'ENOENT') throw e; });
    if (!info && file !== 'index.html') continue;
    if (!info?.isFile() || info.isSymbolicLink()) throw new Error('Invalid public asset');
    await copyFile(input, resolve(destination, file));
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await build();
