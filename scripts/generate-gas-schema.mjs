import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export function gasSchema(schema) {
  return '// Generated from schema/workspace-v1.json. Do not edit manually.\nvar LIVRARIA_SCHEMA = ' + JSON.stringify(schema, null, 2) + ';\n';
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const schema = JSON.parse(await readFile(new URL('../schema/workspace-v1.json', import.meta.url), 'utf8'));
  await writeFile(new URL('../google-apps-script/Schema.gs', import.meta.url), gasSchema(schema));
}
