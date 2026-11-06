import { pathToFileURL } from 'node:url';
import { consolidateFixture } from './inventory-consolidated.mjs';
import { loadSchema } from './inventory-sheet-metadata.mjs';
import { readFixtureBytes } from './inventory-fixture-records.mjs';
import { validateMappedOperationalFixture } from './inventory-operational-mapper.mjs';

// Reports occurrences, not distinct rejected records; one record can have multiple issues.
export function dryRunFixture(bytes, schema, { operational = false } = {}) {
  const inventory = consolidateFixture(bytes, schema);
  const rejections = [];
  for (const key of inventory.keyProblems) {
    if (key.missingOrInvalid) rejections.push({ code: 'KEY_MISSING_OR_INVALID', sheet: key.sheet, count: key.missingOrInvalid });
    if (key.duplicateOccurrences) rejections.push({ code: 'KEY_DUPLICATE', sheet: key.sheet, count: key.duplicateOccurrences });
  }
  for (const relation of inventory.relations) {
    if (relation.missing) rejections.push({ code: 'RELATION_MISSING', sheet: relation.source, column: relation.column, target: relation.target, count: relation.missing });
    if (relation.ambiguous) rejections.push({ code: 'RELATION_AMBIGUOUS', sheet: relation.source, column: relation.column, target: relation.target, count: relation.ambiguous });
  }
  for (const sheet of inventory.sheets) {
    if (sheet.pendingReview) rejections.push({ code: 'ROWS_PENDING_REVIEW', sheet: sheet.sheet, count: sheet.pendingReview });
  }
  if (!inventory.validator.validatorAccepted) rejections.push({ code: inventory.validator.validatorCode, scope: inventory.validator.scope });
  let operationalValidation = { status: 'NOT_REQUESTED', writePerformed: null };
  if (operational) {
    const codes = new Set(['MAPPING_OPENING_EVIDENCE_REQUIRED', 'MAPPING_OPENING_EVIDENCE_INVALID', 'MAPPING_SALE_UNSUPPORTED', 'MAPPING_DUPLICATE_SALE', 'MAPPING_ORPHAN_ITEM', 'MAPPING_MOVEMENT_ID_INVALID', 'MAPPING_MOVEMENT_TIME_INVALID', 'MAPPING_MOVEMENT_ORDER_AMBIGUOUS', 'OPERATIONAL_IMPORT_INVALID', 'OPERATIONAL_PRODUCTS_INVALID', 'OPERATIONAL_CUSTOMERS_INVALID', 'OPERATIONAL_CUSTOMER_CPF_DUPLICATE', 'OPERATIONAL_CONSENT_INVALID', 'OPERATIONAL_SALES_INVALID', 'OPERATIONAL_SALE_ITEMS_INVALID', 'OPERATIONAL_SALE_TOTAL_INVALID', 'OPERATIONAL_MOVEMENT_INVALID', 'OPERATIONAL_STOCK_CHAIN_INVALID', 'OPERATIONAL_SALE_MOVEMENT_INVALID', 'OPERATIONAL_STOCK_CLOSING_INVALID']);
    try {
      const result = validateMappedOperationalFixture(bytes, schema);
      if (result.writePerformed !== false) throw Error('OPERATIONAL_WRITE_CONTRACT_VIOLATION');
      operationalValidation = { status: 'ACCEPTED', writePerformed: false, counts: { products: result.products, customers: result.customers, sales: result.sales, movements: result.movements } };
    } catch (error) {
      if (!codes.has(error?.message)) throw error;
      operationalValidation = { status: 'REJECTED', writePerformed: null, code: error.message };
      rejections.push({ code: error.message, scope: 'operational' });
    }
  }
  return { mode: 'synthetic-fixture-only', snapshotSha256: inventory.snapshotSha256,
    metadataCompatible: inventory.metadataCompatible, sheets: inventory.sheets, rejections,
    alerts: [{ code: 'PARTIAL_VALIDATION_ONLY' }, { code: 'NOT_READY_FOR_REAL_IMPORT' }],
    validator: inventory.validator, operationalValidation, writePerformed: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if ((process.argv.length !== 4 && process.argv.length !== 5) || process.argv[2] !== '--fixture' || (process.argv.length === 5 && process.argv[4] !== '--operational')) throw Error('INVALID');
    const result = dryRunFixture(await readFixtureBytes(process.argv[3]), await loadSchema(), { operational: process.argv.length === 5 });
    console.log(JSON.stringify(result, null, 2));
    if (!result.validator.minimumReady || result.operationalValidation.status === 'REJECTED') process.exitCode = 1;
  } catch { console.error('INVENTORY_DRY_RUN_FAILED'); process.exitCode = 2; }
}