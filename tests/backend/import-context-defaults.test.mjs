import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveImportMetadata, assignImportMovementVersions, resolveHistoricalSaleTitles } from '../../backend/import-context-defaults.mjs';

const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('defaults are explicit and record provenance without replacing source metadata', () => {
  assert.deepEqual(resolveImportMetadata({ syntheticActorId: actor, allowSyntheticActor: true, isNewDocument: true }),
    { actorId: actor, version: 1, provenance: { actor: 'SYNTHETIC_MIGRATION_ACTOR', version: 'NEW_DOCUMENT_INITIAL_VERSION' } });
  assert.equal(resolveImportMetadata({ sourceActorId: actor, sourceVersion: 3 }).provenance.actor, 'SOURCE');
  assert.throws(() => resolveImportMetadata({ syntheticActorId: actor, isNewDocument: true }));
  assert.throws(() => resolveImportMetadata({ sourceActorId: actor }));
  assert.throws(() => resolveImportMetadata({ sourceActorId: 'bad', sourceVersion: 1, allowSyntheticActor: true, syntheticActorId: actor }));
});

test('historical titles require exactly matching sale snapshot and never fall back to catalog', () => {
  const product = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const items = [{ productId: product, quantity: 2 }];
  const snapshots = [{ saleId: actor, items: [{ productId: product, title: 'Título histórico' }] }];
  assert.deepEqual(resolveHistoricalSaleTitles({ saleId: actor, items, snapshots }),
    [{ ...items[0], title: 'Título histórico', titleProvenance: 'HISTORICAL_SALE_SNAPSHOT' }]);
  assert.throws(() => resolveHistoricalSaleTitles({ saleId: actor, items, snapshots: [] }));
  assert.throws(() => resolveHistoricalSaleTitles({ saleId: actor, items, snapshots: [...snapshots, ...snapshots] }));
  assert.throws(() => resolveHistoricalSaleTitles({ saleId: actor, items, snapshots: [{ saleId: actor, items: [{ productId: product, title: '' }] }] }));
});
test('movement sequence requires complete coherent chain and labels synthetic versions', () => {
  const input = [{ type: 'ENTRADA', quantity: 2, stockBefore: 1, stockAfter: 3 }, { type: 'SAIDA', quantity: 1, stockBefore: 3, stockAfter: 2 }];
  const result = assignImportMovementVersions({ movements: input, openingStock: 1, completeHistory: true });
  assert.deepEqual(result.map(x => [x.versionBefore, x.versionAfter]), [[1, 2], [2, 3]]);
  assert.equal(result[0].versionProvenance, 'IMPORT_LOCAL_SEQUENCE_NOT_SOURCE_HISTORY');
  assert.equal(input[0].versionBefore, undefined);
  assert.throws(() => assignImportMovementVersions({ movements: input, openingStock: 1, completeHistory: false }));
  assert.throws(() => assignImportMovementVersions({ movements: input, openingStock: 2, completeHistory: true }));
});