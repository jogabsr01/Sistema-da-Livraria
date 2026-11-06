import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const names = ['Produtos', 'Produto_Nichos', 'Nichos', 'Clientes', 'Vendas', 'Itens_Venda', 'Movimentacoes_Estoque'];
const schemaPath = fileURLToPath(new URL('../schema/workspace-v1.json', import.meta.url));
const MAX_COLUMNS = 10000;
const fail = () => { throw new Error('INVENTORY_INVALID'); };

export async function loadSchema() {
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
  return names.map(name => {
    const table = schema.tables.find(item => item.name === name);
    if (!table || !Array.isArray(table.columns)) fail();
    return { name, columns: table.columns };
  });
}

// Only allowlisted sheet and column names reach the report; input values never do.
export function analyzeInventory(schema, sheets) {
  if (!Array.isArray(sheets) || sheets.length > 1000) fail();
  const result = [];
  for (const table of schema) {
    const matches = sheets.filter(sheet => sheet.name === table.name);
    if (matches.length > 1) fail();
    if (!matches.length) {
      result.push({ sheet: table.name, present: false, missingColumns: table.columns, compatible: false });
      continue;
    }
    const { headers, rowCapacity, columnCapacity } = matches[0];
    if (!Array.isArray(headers) || headers.length > MAX_COLUMNS || !Number.isSafeInteger(rowCapacity) || rowCapacity < 1 ||
        !Number.isSafeInteger(columnCapacity) || columnCapacity < 1 || columnCapacity > MAX_COLUMNS || headers.length > columnCapacity ||
        headers.some(value => typeof value !== 'string')) fail();
    const missingColumns = table.columns.filter(column => !headers.includes(column));
    const duplicates = table.columns.filter(column => headers.filter(value => value === column).length > 1);
    const unknownCount = headers.filter(value => value !== '' && !table.columns.includes(value)).length;
    const blankCount = headers.filter(value => value === '').length;
    const orderMatches = table.columns.every((column, index) => headers[index] === column);
    const compatible = !missingColumns.length && !duplicates.length && !unknownCount && !blankCount && orderMatches;
    result.push({ sheet: table.name, present: true, rowCapacity, columnCapacity, observedHeaderCells: headers.length,
      missingColumns, duplicateColumns: duplicates, unknownColumnCount: unknownCount, blankHeaderCount: blankCount,
      orderMatches, compatible });
  }
  return { schemaVersion: 1, mode: 'metadata-only', recordCountsAvailable: false,
    unexpectedSheetCount: sheets.filter(sheet => !names.includes(sheet.name)).length,
    compatible: result.every(sheet => sheet.compatible), sheets: result };
}

export function parseFixture(value) {
  if (!value || !Array.isArray(value.sheets)) fail();
  return value.sheets.map(sheet => {
    if (!sheet || typeof sheet.name !== 'string') fail();
    return names.includes(sheet.name) ? { name: sheet.name, headers: sheet.headers, rowCapacity: sheet.rowCapacity, columnCapacity: sheet.columnCapacity } : { name: sheet.name };
  });
}

export async function readGoogleSheets({ spreadsheetId, token, fetchImpl = fetch }) {
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(spreadsheetId || '') || !/^[\x21-\x7e]{10,10000}$/.test(token || '')) fail();
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  async function get(params) {
    let response;
    try { response = await fetchImpl(`${base}?${params}`, { method: 'GET', headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
    catch { fail(); }
    if (!response.ok) fail();
    try { return await response.json(); } catch { fail(); }
  }
  const metadata = await get(new URLSearchParams({ fields: 'spreadsheetId,sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))' }));
  if (metadata.spreadsheetId !== spreadsheetId || !Array.isArray(metadata.sheets) || metadata.sheets.length > 1000) fail();
  const sheets = [];
  for (const item of metadata.sheets) {
    const p = item?.properties;
    if (!p || typeof p.title !== 'string') fail();
    if (!names.includes(p.title)) { sheets.push({ name: p.title }); continue; }
    if (!Number.isSafeInteger(p.sheetId) || !p.gridProperties || !Number.isSafeInteger(p.gridProperties.columnCount) || p.gridProperties.columnCount > MAX_COLUMNS) fail();
    const range = `'${p.title.replaceAll("'", "''")}'!1:1`;
    const data = await get(new URLSearchParams({ ranges: range, includeGridData: 'true', fields: 'spreadsheetId,sheets(properties(sheetId),data(startRow,startColumn,rowData(values(userEnteredValue))))' }));
    if (data.spreadsheetId !== spreadsheetId || !Array.isArray(data.sheets) || data.sheets.length !== 1 || data.sheets[0]?.properties?.sheetId !== p.sheetId) fail();
    const blocks = data.sheets[0].data;
    if (!Array.isArray(blocks) || blocks.length !== 1 || (blocks[0].startRow ?? 0) !== 0 || (blocks[0].startColumn ?? 0) !== 0 || !Array.isArray(blocks[0].rowData) || blocks[0].rowData.length !== 1) fail();
    const cells = blocks[0].rowData[0].values ?? [];
    if (!Array.isArray(cells)) fail();
    const headers = cells.map(cell => {
      const value = cell?.userEnteredValue;
      if (value === undefined) return '';
      // Numbers, formulas, errors and booleans are invalid headers, never evaluated.
      if (typeof value.stringValue !== 'string' || Object.keys(value).length !== 1) fail();
      return value.stringValue;
    });
    sheets.push({ name: p.title, headers, rowCapacity: p.gridProperties.rowCount, columnCapacity: p.gridProperties.columnCount });
  }
  return sheets;
}

async function main(args, env) {
  const schema = await loadSchema();
  let sheets;
  if (args.length === 2 && args[0] === '--fixture') {
    const contents = await readFile(args[1]);
    if (contents.length > 2_000_000) fail();
    sheets = parseFixture(JSON.parse(contents.toString('utf8')));
  } else if (args.length === 1 && args[0] === '--google-read-only' && env.INVENTORY_ALLOW_REAL_READ === 'YES') {
    sheets = await readGoogleSheets({ spreadsheetId: env.INVENTORY_SPREADSHEET_ID, token: env.INVENTORY_SHEETS_TOKEN });
  } else fail();
  const report = analyzeInventory(schema, sheets);
  console.log(JSON.stringify(report, null, 2));
  if (!report.compatible) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(process.argv.slice(2), process.env); }
  catch { console.error('INVENTORY_FAILED'); process.exitCode = 1; }
}