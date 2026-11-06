import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { normalizeProduct } from '../../backend/catalog-model.mjs';
import { createFirestoreAccessService } from '../../backend/firestore-access.mjs';
import { createFirestoreIdentityService } from '../../backend/firestore-identity.mjs';
import { createFirestoreOperationsService } from '../../backend/firestore-operations.mjs';
import { createFirestoreSalesService } from '../../backend/firestore-sales.mjs';
import { createFirestoreCatalogService } from '../../backend/firestore-catalog.mjs';
import { createFirestoreEmulatorDb, firestoreEmulatorAvailable } from '../helpers/firestore-emulator.mjs';

const skip = !firestoreEmulatorAvailable();
const now = Date.parse('2026-01-01T12:00:00.000Z');
const nicheId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TRANSIENT_CONFLICT = 'FIRESTORE_TRANSACTION_CONFLICT';

function product(id, stock = 1, version = 1) {
  const record = normalizeProduct({
    isbn: '',
    internalCode: '',
    title: 'Livro concorrente',
    author: 'Autor',
    publisher: 'Editora',
    edition: '',
    supplier: 'Fornecedor',
    priceCents: 1200,
    minimumStock: 1,
    category: 'Categoria',
    coverUrl: '',
    year: 2020,
    pages: 100,
    synopsis: 'Sinopse',
    nicheIds: [nicheId],
    active: true,
  }, id);
  return { ...record, stock, version, updatedAt: new Date(now), hasPhoto: false };
}

async function seedIdentity(db, role = 'ATENDENTE') {
  const userId = randomUUID(), sessionId = randomUUID(), tokenHash = createHash('sha256').update(randomUUID()).digest('hex');
  await db.collection('users').doc(userId).set({ id: userId, role, status: 'ATIVO', authorizationVersion: 1 });
  await db.collection('sessions').doc(sessionId).set({ sessionId, userId, assurance: 'passkey', authorizationVersion: 1,
    authenticatedAt: new Date(now - 1000), expiresAt: new Date(now + 86400000 - 1000), revokedAt: null });
  await db.collection('sessionTokenIndex').doc(tokenHash).set({ sessionId, userId, expiresAt: new Date(now + 86400000 - 1000) });
  return { userId, sessionId, tokenHash, actor: { sessionTokenHash: tokenHash } };
}

test('Firestore emulator persists extended product and initial movement transactionally', { skip }, async t => {
  const db = createFirestoreEmulatorDb({ namespace: 'productext', demo: true }); t.after(() => db.terminate());
  const identity = await seedIdentity(db, 'ADMIN');
  await db.collection('niches').doc(nicheId).set({ name: 'Geral', description: '', color: '#205B43', order: 0, active: true, version: 1, hasImage: false });
  const service = createFirestoreCatalogService({ db, identityService: createFirestoreIdentityService({ db, now: () => now }), now: () => now, config: {} });
  const id = randomUUID(), commandId = randomUUID(), record = { title: 'Caderno', subtitle: 'Pautado', costCents: 750, sku: 'ABC-123', coverUrl: 'https://covers.example.org/book.jpg', priceCents: 1500, nicheIds: [nicheId], active: true };
  const command = { id, commandId, expectedVersion: 0, record, initialStock: 7 };
  const result = await service.execute('save', identity.actor, command);
  assert.deepEqual(await service.execute('save', identity.actor, command), result);
  const saved = (await db.collection('products').doc(id).get()).data();
  assert.equal(saved.subtitle, 'Pautado'); assert.equal(saved.costCents, 750); assert.equal(saved.sku, 'ABC-123'); assert.equal(saved.stock, 7);
  assert.equal(saved.coverUrl, 'https://covers.example.org/book.jpg');
  const movement = (await db.collection('stockMovements').doc(`${commandId}:${id}`).get()).data();
  assert.equal(movement.quantity, 7); assert.equal(movement.stockAfter, 7);
});

function sale(id, productId, quantity = 1, totalCents = quantity * 1200) {
  return { idempotencyKey: id, customerId: null, expectedTotalCents: totalCents, paymentMethod: 'PIX', items: [{ productId, quantity }] };
}

function outcomeSummary(results) {
  return results.map(result => result.status === 'fulfilled' ? 'fulfilled' : `rejected:${result.reason?.code || result.reason?.name || 'UNKNOWN'}`).join(', ');
}

function inspectConcurrent(results, { maximumSuccesses, allowedErrors }) {
  const successes = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') successes.push({ index, value: result.value });
    else assert.ok(allowedErrors.includes(result.reason?.code), `unexpected concurrent outcome: ${outcomeSummary(results)}`);
  });
  assert.ok(successes.length <= maximumSuccesses, `too many successful effects: ${outcomeSummary(results)}`);
  return successes;
}

async function retryTransientConflict(operation, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (error?.code !== TRANSIENT_CONFLICT) throw error;
      lastError = error;
      if (attempt < maxAttempts) await new Promise(resolve => setTimeout(resolve, 100 * 3 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function document(db, collection, id) {
  const snapshot = await db.collection(collection).doc(id).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function assertSaleEffects(db, commandId, productId, expected) {
  const command = await document(db, 'commands', `sales:${commandId}`);
  assert.equal(command?.state, 'COMMITTED');
  assert.deepEqual(command?.result, expected);
  assert.equal((await document(db, 'sales', commandId))?.idempotencyKey, commandId);
  assert.equal((await document(db, 'stockMovements', `${commandId}:${productId}`))?.saleId, commandId);
  assert.equal((await document(db, 'domainEvents', `sales:${commandId}`))?.idempotencyKey, commandId);
  assert.equal((await document(db, 'auditEvents', `sales:${commandId}`))?.commandId, commandId);
  assert.equal((await db.collection('sales').doc(commandId).collection('items').doc(productId).get()).exists, true);
}

test('Firestore emulator preserves one winner for last-unit checkout and keeps journal integrity', { skip }, async t => {
  const db = createFirestoreEmulatorDb({ namespace: 'last-unit' });
  t.after(async () => db.terminate());
  const identity = await seedIdentity(db);
  const productId = randomUUID();
  await db.collection('products').doc(productId).set(product(productId, 1));
  const sales = createFirestoreSalesService({ db, identityService: createFirestoreIdentityService({ db, now: () => now }), config: {}, now: () => now });
  const requests = [sale(randomUUID(), productId), sale(randomUUID(), productId)];
  const initial = await Promise.allSettled(requests.map(request => sales.checkout(identity.actor, request)));
  const successes = inspectConcurrent(initial, { maximumSuccesses: 1, allowedErrors: ['INSUFFICIENT_STOCK', TRANSIENT_CONFLICT] });
  const winner = successes[0] || { index: 0, value: await retryTransientConflict(() => sales.checkout(identity.actor, requests[0])) };
  const loserIndex = winner.index === 0 ? 1 : 0;
  const winnerId = requests[winner.index].idempotencyKey, loserId = requests[loserIndex].idempotencyKey;

  assert.deepEqual(await retryTransientConflict(() => sales.checkout(identity.actor, requests[winner.index])), winner.value);
  await assert.rejects(retryTransientConflict(() => sales.checkout(identity.actor, requests[loserIndex])), { code: 'INSUFFICIENT_STOCK', status: 409 });
  const stored = await document(db, 'products', productId);
  assert.equal(stored.stock, 0);
  assert.equal(stored.version, 2);
  await assertSaleEffects(db, winnerId, productId, winner.value);
  assert.equal(await document(db, 'commands', `sales:${loserId}`), null);
  assert.equal(await document(db, 'sales', loserId), null);
  assert.equal(await document(db, 'stockMovements', `${loserId}:${productId}`), null);
  assert.equal(await document(db, 'domainEvents', `sales:${loserId}`), null);
  assert.equal(await document(db, 'auditEvents', `sales:${loserId}`), null);
});

test('Firestore emulator makes same-command retries converge and rejects payload reuse', { skip }, async t => {
  const db = createFirestoreEmulatorDb({ namespace: 'idempotency' });
  t.after(async () => db.terminate());
  const identity = await seedIdentity(db);
  const sales = createFirestoreSalesService({ db, identityService: createFirestoreIdentityService({ db, now: () => now }), config: {}, now: () => now });

  const sameProduct = randomUUID(), sameCommand = randomUUID();
  await db.collection('products').doc(sameProduct).set(product(sameProduct, 2));
  const sameRequest = sale(sameCommand, sameProduct);
  const sameInitial = await Promise.allSettled([
    sales.checkout(identity.actor, sameRequest),
    sales.checkout(identity.actor, structuredClone(sameRequest)),
  ]);
  const sameSuccesses = inspectConcurrent(sameInitial, { maximumSuccesses: 2, allowedErrors: [TRANSIENT_CONFLICT] });
  const canonical = await retryTransientConflict(() => sales.checkout(identity.actor, sameRequest));
  for (const success of sameSuccesses) assert.deepEqual(success.value, canonical);
  assert.deepEqual(await retryTransientConflict(() => sales.checkout(identity.actor, sameRequest)), canonical);
  assert.equal((await document(db, 'products', sameProduct)).stock, 1);
  assert.equal((await document(db, 'products', sameProduct)).version, 2);
  await assertSaleEffects(db, sameCommand, sameProduct, canonical);

  const conflictProduct = randomUUID(), conflictCommand = randomUUID();
  await db.collection('products').doc(conflictProduct).set(product(conflictProduct, 3));
  const requests = [sale(conflictCommand, conflictProduct, 1, 1200), sale(conflictCommand, conflictProduct, 2, 2400)];
  const conflictInitial = await Promise.allSettled(requests.map(request => sales.checkout(identity.actor, request)));
  const conflictSuccesses = inspectConcurrent(conflictInitial, { maximumSuccesses: 1, allowedErrors: ['IDEMPOTENCY_CONFLICT', TRANSIENT_CONFLICT] });
  const winner = conflictSuccesses[0] || { index: 0, value: await retryTransientConflict(() => sales.checkout(identity.actor, requests[0])) };
  const loserIndex = winner.index === 0 ? 1 : 0;

  assert.equal(winner.value.items[0].quantity, requests[winner.index].items[0].quantity);
  assert.deepEqual(await retryTransientConflict(() => sales.checkout(identity.actor, requests[winner.index])), winner.value);
  await assert.rejects(retryTransientConflict(() => sales.checkout(identity.actor, requests[loserIndex])), { code: 'IDEMPOTENCY_CONFLICT', status: 409 });
  const stored = await document(db, 'products', conflictProduct);
  assert.equal(stored.stock, 3 - winner.value.items[0].quantity);
  assert.equal(stored.version, 2);
  await assertSaleEffects(db, conflictCommand, conflictProduct, winner.value);
});

test('Firestore emulator serializes concurrent stock adjustments and consumes one email code', { skip }, async t => {
  const db = createFirestoreEmulatorDb({ namespace: 'adjust-code' });
  t.after(async () => db.terminate());
  const identity = await seedIdentity(db, 'ADMIN');
  const productId = randomUUID();
  await db.collection('products').doc(productId).set(product(productId, 3));
  const operations = createFirestoreOperationsService({ db, identityService: createFirestoreIdentityService({ db, now: () => now }), config: {}, now: () => now });
  const commands = [
    { commandId: randomUUID(), id: productId, expectedVersion: 1, newStock: 4, reason: 'Ajuste A' },
    { commandId: randomUUID(), id: productId, expectedVersion: 1, newStock: 5, reason: 'Ajuste B' },
  ];
  const adjustmentInitial = await Promise.allSettled(commands.map(command => operations.execute('adjust', identity.actor, command)));
  const adjustmentSuccesses = inspectConcurrent(adjustmentInitial, { maximumSuccesses: 1, allowedErrors: ['OPERATION_CONFLICT', TRANSIENT_CONFLICT] });
  const winner = adjustmentSuccesses[0] || { index: 0, value: await retryTransientConflict(() => operations.execute('adjust', identity.actor, commands[0])) };
  const loserIndex = winner.index === 0 ? 1 : 0;
  const winnerCommand = commands[winner.index], loserCommand = commands[loserIndex];

  assert.equal(winner.value.commandId, winnerCommand.commandId);
  assert.deepEqual(await retryTransientConflict(() => operations.execute('adjust', identity.actor, winnerCommand)), winner.value);
  await assert.rejects(retryTransientConflict(() => operations.execute('adjust', identity.actor, loserCommand)), { code: 'OPERATION_CONFLICT', status: 409 });
  const storedProduct = await document(db, 'products', productId);
  assert.equal(storedProduct.stock, winnerCommand.newStock);
  assert.equal(storedProduct.version, 2);
  assert.equal((await document(db, 'commands', `operations:${winnerCommand.commandId}`))?.state, 'COMMITTED');
  assert.equal((await document(db, 'stockMovements', `${winnerCommand.commandId}:${productId}`))?.stockAfter, winnerCommand.newStock);
  assert.equal((await document(db, 'domainEvents', `operations:${winnerCommand.commandId}`))?.idempotencyKey, winnerCommand.commandId);
  assert.equal((await document(db, 'auditEvents', `operations:${winnerCommand.commandId}`))?.commandId, winnerCommand.commandId);
  assert.equal(await document(db, 'commands', `operations:${loserCommand.commandId}`), null);
  assert.equal(await document(db, 'stockMovements', `${loserCommand.commandId}:${productId}`), null);
  assert.equal(await document(db, 'domainEvents', `operations:${loserCommand.commandId}`), null);
  assert.equal(await document(db, 'auditEvents', `operations:${loserCommand.commandId}`), null);

  const tokenHash = createHash('sha256').update(randomUUID()).digest('hex');
  const flowId = randomUUID(), subjectId = randomUUID(), codeHash = 'c'.repeat(64);
  await db.collection('authFlows').doc(tokenHash).set({ flowId, subjectId, purpose: 'ACTIVATE', state: 'EMAIL', authorizationVersion: 1,
    tokenHash, codeHash, attempts: 0, createdAt: new Date(now), codeExpiresAt: new Date(now + 900000),
    flowExpiresAt: new Date(now + 900000), expiresAt: new Date(now + 900000) });
  const access = createFirestoreAccessService({ db, config: { environment: 'dev', installationId: randomUUID(), secret: 'ab'.repeat(32) }, now: () => now });
  const proofInitial = await Promise.allSettled([access.email({ tokenHash, codeHash }), access.email({ tokenHash, codeHash })]);
  const proofSuccesses = inspectConcurrent(proofInitial, { maximumSuccesses: 1, allowedErrors: ['ACCESS_REJECTED', TRANSIENT_CONFLICT] });
  const proof = proofSuccesses[0]?.value || await retryTransientConflict(() => access.email({ tokenHash, codeHash }));

  assert.deepEqual(proof, { verified: true });
  await assert.rejects(retryTransientConflict(() => access.email({ tokenHash, codeHash })), { code: 'ACCESS_REJECTED', status: 401 });
  const flow = await document(db, 'authFlows', tokenHash);
  assert.equal(flow.state, 'PASSWORD');
  assert.equal(flow.codeHash, null);
  assert.equal(flow.attempts, 0);
  assert.equal(flow.verifiedAt.toMillis(), now);
});
