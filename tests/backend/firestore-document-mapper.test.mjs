import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mapNicheDocuments, mapProductDocuments, mapCustomerDocuments, mapStockMovementDocuments, mapSaleDocuments, resolveExistingCustomer, resolveExistingMedia } from '../../backend/firestore-document-mapper.mjs';
import { createPersonalDataVault } from '../../backend/personal-data.mjs';
import { Timestamp } from '@google-cloud/firestore';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const timestamp = '2026-01-01T00:00:00.000Z';
const photoBytes = Buffer.from('fake-photo');
const photo = { bytes: photoBytes.toString('base64'), sha256: createHash('sha256').update(photoBytes).digest('hex') };
const niche = () => ({ id, actorId, timestamp, version: 1, record: { name: 'Livros', description: '', color: '#abcdef', order: 1, active: true }, image: photo });
const product = () => ({ id, actorId, timestamp, version: 1, stock: 3, cover: photo, record: { isbn: '9780140328721', title: 'Livro', author: 'Autora', priceCents: 100, nicheIds: [id], active: true } });

test('maps niche and cover metadata with matching uniqueness and search projections', () => {
  const n = mapNicheDocuments(niche()), p = mapProductDocuments(product());
  assert.equal(n.find(d => d.path === `niches/${id}`).data.hasImage, true);
  assert.equal(n.find(d => d.path === `niches/${id}/media/image`).data.sha256, photo.sha256);
  assert.equal(n.find(d => d.path === 'uniqueness/niche-name:livros').data.nicheId, id);
  assert.equal(p.find(d => d.path === `products/${id}`).data.hasPhoto, true);
  assert.equal(p.find(d => d.path === `products/${id}/media/cover`).data.sha256, photo.sha256);
  assert.ok(p.find(d => d.path === `productSearch/${id}`).data.tokens.includes('liv'));
  assert.equal(p.find(d => d.path === 'uniqueness/active-isbn:9780140328721').data.ownerId, id);
});

test('rejects missing media policy, invalid hashes, bad identifiers and negative stock', () => {
  assert.throws(() => mapNicheDocuments({ ...niche(), image: undefined }));
  assert.throws(() => mapProductDocuments({ ...product(), cover: { ...photo, sha256: '0'.repeat(64) } }));
  assert.throws(() => mapProductDocuments({ ...product(), id: 'legacy-id' }));
  assert.throws(() => mapProductDocuments({ ...product(), stock: -1 }));
  assert.equal(mapProductDocuments({ ...product(), cover: null })[0].data.hasPhoto, false);
});

test('customer mapping uses stable keyed fingerprint and lookup, but randomized authenticated encryption', () => {
  const vaultSettings = { config: { installationId: actorId, environment: 'dev' }, dataKey: Buffer.alloc(32, 1), indexKey: Buffer.alloc(32, 2) };
  const input = { id, timestamp, consentAt: timestamp, lastPurchase: '', vaultSettings,
    record: { name: 'Pessoa', cpf: '529.982.247-25', email: 'pessoa@example.test', phone: '', contactPreference: 'EMAIL', marketingConsent: true } };
  const a = mapCustomerDocuments(input), b = mapCustomerDocuments(input);
  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(a.documents[0].data.cpfIndex, b.documents[0].data.cpfIndex);
  assert.notEqual(a.documents[0].data.contact, b.documents[0].data.contact);
  assert.equal(createPersonalDataVault(vaultSettings).open('customers', id, a.documents[0].data.contact).cpf, '52998224725');
  assert.doesNotMatch(JSON.stringify(a), /pessoa@example|52998224725/);
  assert.notEqual(a.fingerprint, mapCustomerDocuments({ ...input, record: { ...input.record, name: 'Outra' } }).fingerprint);
});

test('maps historical movement and sale with deterministic ids and validates versions and totals', () => {
  const movement = { commandId: actorId, productId: id, at: timestamp, type: 'SAIDA', quantity: 2, stockBefore: 5, stockAfter: 3,
    versionBefore: 2, versionAfter: 3, reason: 'VENDA', saleId: actorId, operatorId: actorId };
  const sale = { idempotencyKey: actorId, customerId: null, attendantId: actorId, createdAt: timestamp, paymentMethod: 'PIX', totalCents: 200,
    items: [{ productId: id, title: 'Livro', quantity: 2, unitPriceCents: 100, subtotalCents: 200 }] };
  assert.equal(mapStockMovementDocuments(movement)[0].path, `stockMovements/${actorId}:${id}`);
  assert.equal(mapSaleDocuments(sale)[1].path, `sales/${actorId}/items/${id}`);
  assert.throws(() => mapStockMovementDocuments({ ...movement, versionAfter: 4 }));
  assert.throws(() => mapSaleDocuments({ ...sale, totalCents: 201 }));
});

test('customer reuse preserves ciphertext only for fully matching authenticated record', () => {
  const vaultSettings = { config: { installationId: actorId, environment: 'dev' }, dataKey: Buffer.alloc(32, 1), indexKey: Buffer.alloc(32, 2) };
  const input = { id, timestamp, consentAt: '', lastPurchase: '', vaultSettings,
    record: { name: 'Pessoa', cpf: '52998224725', email: '', phone: '', contactPreference: 'NONE', marketingConsent: false } };
  const a = mapCustomerDocuments(input), b = mapCustomerDocuments(input), existing = a.documents[0].data;
  assert.equal(resolveExistingCustomer({ mapped: b, existing, vaultSettings }).documents[0].data.contact, existing.contact);
  assert.throws(() => resolveExistingCustomer({ mapped: mapCustomerDocuments({ ...input, record: { ...input.record, name: 'Outra' } }), existing, vaultSettings }));
  assert.throws(() => resolveExistingCustomer({ mapped: b, existing: { ...existing, contact: 'tampered' }, vaultSettings }));
  assert.throws(() => resolveExistingCustomer({ mapped: b, existing: { ...existing, revision: 2 }, vaultSettings }));
});

test('media preservation rejects mismatched or inconsistent existing media', () => {
  const mapped = mapProductDocuments({ ...product(), cover: null });
  const preserved = resolveExistingMedia({ documents: mapped, parentPath: `products/${id}`, flag: 'hasPhoto',
    existingParent: { hasPhoto: true }, existingMedia: { ...photo, updatedAt: timestamp } });
  assert.equal(preserved[0].data.hasPhoto, true);
  assert.equal(preserved.some(doc => doc.path.endsWith('/media/cover')), false);
  assert.throws(() => resolveExistingMedia({ documents: mapped, parentPath: `products/${id}`, flag: 'hasPhoto', existingParent: { hasPhoto: true }, existingMedia: null }));
  const differentBytes = Buffer.from('different'), different = { bytes: differentBytes.toString('base64'), sha256: createHash('sha256').update(differentBytes).digest('hex'), updatedAt: timestamp };
  assert.throws(() => resolveExistingMedia({ documents: mapProductDocuments(product()), parentPath: `products/${id}`, flag: 'hasPhoto', existingParent: { hasPhoto: true }, existingMedia: different }));
});

test('media preservation accepts Firestore Timestamp and rejects malformed timestamp', () => {
  const documents = mapNicheDocuments({ ...niche(), image: null });
  const args = { documents, parentPath: `niches/${id}`, flag: 'hasImage', existingParent: { hasImage: true } };
  const result = resolveExistingMedia({ ...args, existingMedia: { ...photo, updatedAt: Timestamp.fromDate(new Date(timestamp)) } });
  assert.equal(result[0].data.hasImage, true);
  assert.throws(() => resolveExistingMedia({ ...args, existingMedia: { ...photo, updatedAt: 'invalid' } }));
});