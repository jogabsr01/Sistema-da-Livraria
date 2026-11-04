import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { dryRunFixture } from './inventory-dry-run.mjs';
import { readFixtureBytes } from './inventory-fixture-records.mjs';
import { loadSchema } from './inventory-sheet-metadata.mjs';
import { preflight } from './firestore-import-preflight.mjs';

const domains = [ ['niches', 'Nichos'], ['products', 'Produtos'], ['customers', 'Clientes'], ['stock', 'Movimentacoes_Estoque'], ['sales', 'Vendas'] ];
const MAX_BATCH_RECORDS = 100;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// This is a planning identifier, not a Firestore document ID or a persisted checkpoint.
function planImportFixture(bytes, schema, { batchSize = MAX_BATCH_RECORDS } = {}) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_RECORDS) throw Error('IMPORT_PLAN_BATCH_INVALID');
  const report = dryRunFixture(bytes, schema, { operational: true });
  if (!report.validator.minimumReady || report.validator.writePerformed !== false ||
      report.operationalValidation.status !== 'ACCEPTED' || report.operationalValidation.writePerformed !== false || report.writePerformed !== false) {
    return { mode: 'planning-only', status: 'VALIDATION_REJECTED', writePerformed: false, rejections: report.rejections };
  }
  const runId = hash(['fixture-import-plan-v1', report.snapshotSha256, batchSize]);
  const plan = domains.map(([domain, sheet]) => {
    const count = report.sheets.find(item => item.sheet === sheet).recordCount;
    const batches = [];
    for (let start = 0; start < count; start += batchSize) {
      const index = batches.length;
      batches.push({ index, count: Math.min(batchSize, count - start), simulatedCheckpointId: hash([runId, domain, index]) });
    }
    return { domain, recordCount: count, batches, audit: { event: 'PLAN_CREATED', persistence: 'NONE' } };
  });
  return { mode: 'planning-only', status: 'PLANNED_NOT_WRITTEN', runId, batchSize, domains: plan, writePerformed: false };
}

export async function inspectAndPlanFixture(path, { env = process.env, batchSize = MAX_BATCH_RECORDS } = {}) {
  const inspection = await preflight(env);
  if (inspection.status !== 'INSPECTION_ONLY' || inspection.mode !== 'emulator' ||
      inspection.backupHashVerified !== true || inspection.loopbackPortReachable !== true || inspection.writePerformed !== false) {
    throw Error('IMPORT_PREFLIGHT_FAILED');
  }
  const result = planImportFixture(await readFixtureBytes(path), await loadSchema(), { batchSize });
  return { ...result, preflight: inspection };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    // Only the preflight loopback probe is permitted; there is no Firestore client or write mode.
    if (process.argv.length !== 4 || process.argv[2] !== '--fixture') throw Error('IMPORT_RUNNER_DISABLED');
    const result = await inspectAndPlanFixture(process.argv[3]);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'PLANNED_NOT_WRITTEN') process.exitCode = 1;
  } catch { console.error('IMPORT_RUNNER_DISABLED_OR_INVALID'); process.exitCode = 2; }
}