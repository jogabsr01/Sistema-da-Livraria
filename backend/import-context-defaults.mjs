import { catalogUuid } from './catalog-model.mjs';

const fail = () => { throw Error('IMPORT_CONTEXT_INVALID'); };

// Synthetic defaults identify the migration, never a historical human actor.
export function resolveImportMetadata({ sourceActorId, sourceVersion, syntheticActorId, allowSyntheticActor = false, isNewDocument = false } = {}) {
  if (typeof allowSyntheticActor !== 'boolean' || typeof isNewDocument !== 'boolean') fail();
  const hasActor = sourceActorId !== undefined && sourceActorId !== null && sourceActorId !== '';
  const hasVersion = sourceVersion !== undefined && sourceVersion !== null && sourceVersion !== '';
  if (hasActor && !catalogUuid(sourceActorId)) fail();
  if (!hasActor && (!allowSyntheticActor || !catalogUuid(syntheticActorId))) fail();
  if (hasVersion && (!Number.isSafeInteger(sourceVersion) || sourceVersion < 1)) fail();
  if (!hasVersion && !isNewDocument) fail();
  return Object.freeze({ actorId: hasActor ? sourceActorId : syntheticActorId,
    version: hasVersion ? sourceVersion : 1,
    provenance: Object.freeze({ actor: hasActor ? 'SOURCE' : 'SYNTHETIC_MIGRATION_ACTOR',
      version: hasVersion ? 'SOURCE' : 'NEW_DOCUMENT_INITIAL_VERSION' }) });
}

// Sequence numbers are assigned only for an explicitly complete, ordered synthetic chain.
// They are import-local revisions, not a claim about versions in the source.
export function assignImportMovementVersions({ movements, openingStock, completeHistory, openingVersion = 1 } = {}) {
  if (completeHistory !== true || !Array.isArray(movements) || !Number.isSafeInteger(openingStock) || openingStock < 0 ||
      !Number.isSafeInteger(openingVersion) || openingVersion < 1) fail();
  let stock = openingStock, version = openingVersion;
  return movements.map(movement => {
    if (!movement || !['ENTRADA', 'SAIDA'].includes(movement.type) || !Number.isSafeInteger(movement.quantity) || movement.quantity < 1 ||
        !Number.isSafeInteger(movement.stockBefore) || !Number.isSafeInteger(movement.stockAfter) || movement.stockBefore !== stock ||
        movement.stockAfter !== stock + (movement.type === 'ENTRADA' ? movement.quantity : -movement.quantity) || movement.stockAfter < 0 ||
        !Number.isSafeInteger(version + 1)) fail();
    const result = { ...movement, versionBefore: version, versionAfter: version + 1,
      versionProvenance: 'IMPORT_LOCAL_SEQUENCE_NOT_SOURCE_HISTORY' };
    stock = movement.stockAfter; version++;
    return result;
  });
}

// Historical names must come from a trusted sale snapshot, not today's catalog.
export function resolveHistoricalSaleTitles({ saleId, items, snapshots } = {}) {
  if (!catalogUuid(saleId) || !Array.isArray(items) || !Array.isArray(snapshots) || !items.length || items.length > 100) fail();
  const matches = snapshots.filter(snapshot => snapshot && snapshot.saleId === saleId);
  if (matches.length !== 1 || !Array.isArray(matches[0].items) || matches[0].items.length !== items.length) fail();
  const titles = new Map();
  for (const item of matches[0].items) {
    if (!item || !catalogUuid(item.productId) || titles.has(item.productId) || typeof item.title !== 'string' ||
        !item.title.trim() || item.title !== item.title.trim() || item.title.length > 300 || /[\x00-\x1f\x7f]/.test(item.title)) fail();
    titles.set(item.productId, item.title);
  }
  const seen = new Set();
  return items.map(item => {
    if (!item || !catalogUuid(item.productId) || seen.has(item.productId) || !titles.has(item.productId)) fail();
    seen.add(item.productId);
    return { ...item, title: titles.get(item.productId), titleProvenance: 'HISTORICAL_SALE_SNAPSHOT' };
  });
}