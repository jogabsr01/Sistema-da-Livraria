import { pathToFileURL } from 'node:url';
import { validateProductImport } from '../backend/import-plan.mjs';
import { analyzeInventory, loadSchema } from './inventory-sheet-metadata.mjs';
import { analyzeFixtureRecords, invalidFixtureCell, readFixtureBytes } from './inventory-fixture-records.mjs';

const keys = {
  Produtos: ['ID_Produto'], Nichos: ['ID_Nicho'], Produto_Nichos: ['ID_Produto', 'ID_Nicho'],
  Clientes: ['ID_Cliente'], Vendas: ['ID_Venda'], Itens_Venda: ['ID_Venda', 'ID_Produto'],
  Movimentacoes_Estoque: ['ID_Movimentacao'],
};
const links = [
  ['Produto_Nichos', 'ID_Produto', 'Produtos', 'ID_Produto', false],
  ['Produto_Nichos', 'ID_Nicho', 'Nichos', 'ID_Nicho', false],
  ['Itens_Venda', 'ID_Produto', 'Produtos', 'ID_Produto', false],
  ['Itens_Venda', 'ID_Venda', 'Vendas', 'ID_Venda', false],
  ['Vendas', 'ID_Cliente', 'Clientes', 'ID_Cliente', true],
  ['Movimentacoes_Estoque', 'ID_Produto', 'Produtos', 'ID_Produto', false],
  ['Movimentacoes_Estoque', 'ID_Venda', 'Vendas', 'ID_Venda', true],
];
const blank = value => value === null || (typeof value === 'string' && !value.trim());
const validKey = value => typeof value === 'string' && value.trim() !== '' && value === value.trim();
const keyOf = values => JSON.stringify(values);

export function consolidateFixture(bytes, schema, { validator = validateProductImport } = {}) {
  // Validates schema, bounds, rows, and primitive cell types before working with the fixture.
  const records = analyzeFixtureRecords(bytes, schema);
  const fixture = JSON.parse(bytes.toString('utf8'));
  const metadata = analyzeInventory(schema, fixture.sheets.map(sheet => ({ name: sheet.name, headers: sheet.headers,
    rowCapacity: Math.max(1, sheet.rows.length + 1), columnCapacity: Math.max(1, sheet.headers.length) })));
  const rows = Object.fromEntries(fixture.sheets.map(sheet => [
    sheet.name,
    sheet.rows.filter(row => !row.every(blank)).map(row => Object.fromEntries(sheet.headers.map((column, index) => [column, row[index]]))),
  ]));
  const pending = Object.fromEntries(Object.entries(rows).map(([name, items]) => [name, items.map(item => Object.entries(item).some(([column, value]) => invalidFixtureCell(name, column, value)))]));
  const keyProblems = [];
  for (const [name, columns] of Object.entries(keys)) {
    const seen = new Map(); let missing = 0, duplicate = 0;
    rows[name].forEach((row, index) => {
      const values = columns.map(column => row[column]);
      if (!values.every(validKey)) { missing++; pending[name][index] = true; return; }
      const key = keyOf(values);
      if (seen.has(key)) { duplicate++; pending[name][index] = true; pending[name][seen.get(key)] = true; }
      else seen.set(key, index);
    });
    keyProblems.push({ sheet: name, missingOrInvalid: missing, duplicateOccurrences: duplicate });
  }
  const relations = links.map(([source, column, target, targetColumn, optional]) => {
    const targetCounts = new Map();
    for (const row of rows[target]) if (validKey(row[targetColumn])) targetCounts.set(row[targetColumn], (targetCounts.get(row[targetColumn]) || 0) + 1);
    let missing = 0, ambiguous = 0;
    rows[source].forEach((row, index) => {
      const value = row[column];
      if (optional && blank(value)) return;
      const count = validKey(value) ? targetCounts.get(value) || 0 : 0;
      if (count !== 1) { if (count === 0) missing++; else ambiguous++; pending[source][index] = true; }
    });
    return { source, column, target, targetColumn, missing, ambiguous };
  });
  const summaries = records.sheets.map(sheet => {
    const pendingCount = pending[sheet.sheet].filter(Boolean).length;
    return { sheet: sheet.sheet, recordCount: sheet.recordCount, blankRowCount: sheet.blankRowCount,
      passedPreliminaryChecks: sheet.recordCount - pendingCount, pendingReview: pendingCount };
  });

  // Candidate is deliberately minimal: the existing validator covers products/niches only.
  const nicheByProduct = new Map();
  for (const row of rows.Produto_Nichos) {
    const existing = nicheByProduct.get(row.ID_Produto) || [];
    existing.push(row.ID_Nicho); nicheByProduct.set(row.ID_Produto, existing);
  }
  const candidate = { environment: 'dev', schemaVersion: 1,
    niches: rows.Nichos.map(row => ({ id: row.ID_Nicho, nome: row.Nome })),
    products: rows.Produtos.map(row => ({ isbn: blank(row.ISBN) ? row.Codigo_Interno : row.ISBN,
      semCodigo: blank(row.ISBN), titulo: row.Titulo, precoCentavos: row.Preco_Venda,
      estoque: row.Estoque_Atual, nichos: nicheByProduct.get(row.ID_Produto) || [] })) };
  let validatorAccepted = false, validatorCode = null, validationResult;
  try { validationResult = validator(candidate); }
  catch (error) {
    const allowed = ['IMPORT_INVALID', 'IMPORT_NICHES_INVALID', 'IMPORT_PRODUCT_INVALID', 'IMPORT_IDENTIFIER_INVALID', 'IMPORT_DUPLICATE', 'IMPORT_FORMULA_REVIEW_REQUIRED'];
    validatorCode = allowed.includes(error?.message) ? error.message : 'IMPORT_INVALID';
  }
  if (validationResult !== undefined) {
    if (!validationResult || validationResult.writePerformed !== false) throw new Error('VALIDATOR_WRITE_CONTRACT_VIOLATION');
    validatorAccepted = true;
  } else if (validatorCode === null) {
    throw new Error('VALIDATOR_WRITE_CONTRACT_VIOLATION');
  }
  const issues = summaries.some(sheet => sheet.pendingReview > 0);
  return { schemaVersion: 1, mode: 'synthetic-fixture-dry-run', snapshotSha256: records.snapshotSha256,
    metadataCompatible: metadata.compatible, sheets: summaries, keyProblems, relations,
    validator: { scope: 'minimal-products-and-niches-only', validatorAccepted, validatorCode, writePerformed: validatorAccepted ? false : null,
      minimumReady: validatorAccepted && !issues, candidateTransformedInMemory: true,
      fullMigrationReady: false } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--fixture') throw Error('INVALID');
    const result = consolidateFixture(await readFixtureBytes(process.argv[3]), await loadSchema());
    console.log(JSON.stringify(result, null, 2));
    if (!result.validator.minimumReady) process.exitCode = 1;
  } catch { console.error('CONSOLIDATED_INVENTORY_FAILED'); process.exitCode = 1; }
}