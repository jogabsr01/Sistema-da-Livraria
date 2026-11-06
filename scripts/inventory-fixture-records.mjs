import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { analyzeInventory, loadSchema } from './inventory-sheet-metadata.mjs';

const MAX_BYTES = 2_000_000;
const MAX_ROWS = 50_000;
const fail = () => { throw new Error('RECORD_INVENTORY_INVALID'); };

// Deliberately limited to unambiguous numeric fields, not all business rules.
const nonnegativeIntegers = {
  Produtos: ['Preco_Venda', 'Estoque_Atual', 'Estoque_Minimo'],
  Vendas: ['Valor_Total'],
  Itens_Venda: ['Preco_Unitario', 'Subtotal'],
  Movimentacoes_Estoque: ['Saldo_Anterior', 'Saldo_Posterior'],
};
const positiveIntegers = { Itens_Venda: ['Quantidade'], Movimentacoes_Estoque: ['Quantidade'] };
const empty = value => value === null || (typeof value === 'string' && value.trim() === '');
const formula = value => typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(value);
export function invalidFixtureCell(sheet, column, value) {
  if (empty(value)) return false;
  const numeric = nonnegativeIntegers[sheet]?.includes(column);
  const positive = positiveIntegers[sheet]?.includes(column);
  return formula(value) || ((numeric || positive) && (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)));
}

// Snapshot is the exact bytes of the local JSON input; no row values enter the report.
export function analyzeFixtureRecords(bytes, schema) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES) fail();
  let fixture;
  try { fixture = JSON.parse(bytes.toString('utf8')); } catch { fail(); }
  if (!fixture || !Array.isArray(fixture.sheets) || fixture.sheets.length !== schema.length) fail();
  const metadata = fixture.sheets.map(sheet => {
    if (!sheet || !Array.isArray(sheet.headers) || !Array.isArray(sheet.rows)) fail();
    return { name: sheet.name, headers: sheet.headers, rowCapacity: Math.max(1, sheet.rows.length + 1), columnCapacity: Math.max(1, sheet.headers.length) };
  });
  let compatible;
  try { compatible = analyzeInventory(schema, metadata).compatible; } catch { fail(); }
  if (!compatible) fail();
  let totalRows = 0;
  const sheets = schema.map(table => {
    const sheet = fixture.sheets.find(item => item.name === table.name);
    if (!sheet) fail();
    totalRows += sheet.rows.length;
    if (totalRows > MAX_ROWS) fail();
    const fields = table.columns.map(column => ({ column, nullOrBlank: 0, invalid: 0 }));
    let recordCount = 0, blankRowCount = 0, invalidRowCount = 0;
    for (const row of sheet.rows) {
      if (!Array.isArray(row) || row.length !== table.columns.length || row.some(value => value !== null && !['string', 'number', 'boolean'].includes(typeof value))) fail();
      if (row.every(empty)) { blankRowCount++; continue; }
      recordCount++;
      let rowInvalid = false;
      row.forEach((value, i) => {
        if (empty(value)) { fields[i].nullOrBlank++; return; }
        const column = table.columns[i];
        if (invalidFixtureCell(table.name, column, value)) {
          fields[i].invalid++; rowInvalid = true;
        }
      });
      if (rowInvalid) invalidRowCount++;
    }
    return { sheet: table.name, recordCount, blankRowCount, invalidRowCount, fields };
  });
  return { schemaVersion: 1, mode: 'synthetic-fixture-only', snapshotSha256: createHash('sha256').update(bytes).digest('hex'),
    hashScope: 'exact-input-bytes', importReady: false, sheets };
}

export async function readFixtureBytes(path) {
  const file = await open(path, 'r');
  let bytes;
  try {
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let count = 0;
    while (count < buffer.length) {
      const result = await file.read(buffer, count, buffer.length - count, null);
      if (!result.bytesRead) break;
      count += result.bytesRead;
    }
    if (count > MAX_BYTES) fail();
    bytes = buffer.subarray(0, count);
  } finally { await file.close(); }
  return bytes;
}

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--fixture') fail();
  console.log(JSON.stringify(analyzeFixtureRecords(await readFixtureBytes(process.argv[3]), await loadSchema()), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); } catch { console.error('RECORD_INVENTORY_FAILED'); process.exitCode = 1; }
}