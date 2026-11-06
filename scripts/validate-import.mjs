import { readFile } from 'node:fs/promises';
import { validateProductImport } from '../backend/import-plan.mjs';
try {
  if (!process.argv[2]) throw Error('IMPORT_FILE_REQUIRED');
  const stat = await import('node:fs/promises').then(fs => fs.stat(process.argv[2]));
  if (stat.size > 10_000_000) throw Error('IMPORT_TOO_LARGE');
  console.log(JSON.stringify(validateProductImport(JSON.parse(await readFile(process.argv[2], 'utf8'))), null, 2));
} catch (error) {
  const code = /^IMPORT_[A-Z_]+$/.test(error.message) ? error.message : 'IMPORT_INVALID';
  console.error(code); process.exitCode = 1;
}
