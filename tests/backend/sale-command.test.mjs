import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSaleService, normalizeSale } from '../../backend/sale-command.mjs';

// Contract double, NOT a Sheets integration or cross-process lock test.
function setup(stock = 2) {
  const productId = randomUUID();
  const actor = { id: randomUUID(), role: 'ATENDENTE' };
  const product = { stock, priceCents: 1990, version: 0, active: true };
  const events = new Map();
  let tail = Promise.resolve();
  let failProjection = false;
  const repo = {
    withLock(fn) { const result = tail.then(fn); tail = result.catch(() => {}); return result; },
    async getProduct(id) { return id === productId ? structuredClone(product) : null; },
    async findEvent(key) { return events.get(key); },
    async appendEvent(event) { assert.equal(events.has(event.idempotencyKey), false); events.set(event.idempotencyKey, structuredClone(event)); },
    async recoverPending() {
      if (failProjection) { failProjection = false; throw Error('simulated projection interruption'); }
      for (const event of events.values()) for (const line of event.lines) {
        if (product.version === line.expectedVersion) {
          product.stock = line.stockAfter; product.version++;
        } // already applied projection is not subtracted twice
      }
    },
  };
  const service = createSaleService(repo);
  return { product, events, actor, productId, service, repo,
    command: () => ({ idempotencyKey: randomUUID(), items: [{ productId, quantity: 1 }] }),
    crashAfterAppend() { const append = repo.appendEvent; repo.appendEvent = async event => { await append(event); failProjection = true; }; } };
}

test('server price, duplicate lines and reordered retries produce one sale', async () => {
  const s = setup(5), command = s.command();
  command.items.push({ ...command.items[0], quantity: 2 });
  const first = await s.service.execute(command, s.actor);
  const retry = await s.service.execute({ ...command, items: [{ productId: s.productId, quantity: 3 }] }, s.actor);
  assert.deepEqual(first, retry); assert.equal(first.totalCents, 5970);
  assert.equal(s.product.stock, 2); assert.equal(s.events.size, 1);
});
test('concurrent last-copy purchases allow exactly one sale', async () => {
  const s = setup(1);
  const results = await Promise.allSettled([s.service.execute(s.command(), s.actor), s.service.execute(s.command(), s.actor)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'INSUFFICIENT_STOCK');
  assert.equal(s.product.stock, 0); assert.equal(s.events.size, 1);
});
test('durable sale survives interruption before stock projection and retry', async () => {
  const s = setup(1), command = s.command(); s.crashAfterAppend();
  await assert.rejects(s.service.execute(command, s.actor), /interruption/);
  assert.equal(s.events.size, 1); assert.equal(s.product.stock, 1);
  const receipt = await s.service.execute(command, s.actor);
  assert.equal(receipt.totalCents, 1990); assert.equal(s.product.stock, 0);
  await assert.rejects(s.service.execute(s.command(), s.actor), { code: 'INSUFFICIENT_STOCK' });
});
test('idempotency key cannot be reused by another actor or command', async () => {
  const s = setup(), command = s.command(); await s.service.execute(command, s.actor);
  await assert.rejects(s.service.execute(command, { ...s.actor, id: randomUUID() }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(s.service.execute({ ...command, items: [{ productId: s.productId, quantity: 2 }] }, s.actor), { code: 'IDEMPOTENCY_CONFLICT' });
});
test('reject injected prices, invalid quantities, unknown products and money overflow without writes', async () => {
  const s = setup();
  assert.throws(() => normalizeSale({ ...s.command(), priceCents: 1 }), { code: 'INVALID_SALE' });
  for (const quantity of [0, -1, 1.2, Infinity, '1']) assert.throws(() => normalizeSale({ ...s.command(), items: [{ productId: s.productId, quantity }] }), { code: 'INVALID_SALE' });
  await assert.rejects(s.service.execute({ ...s.command(), items: [{ productId: randomUUID(), quantity: 1 }] }, s.actor), { code: 'PRODUCT_UNAVAILABLE' });
  s.product.priceCents = Number.MAX_SAFE_INTEGER;
  await assert.rejects(s.service.execute({ ...s.command(), items: [{ productId: s.productId, quantity: 2 }] }, s.actor), { code: 'INVALID_TOTAL' });
  assert.equal(s.events.size, 0);
});
test('unrecognized roles cannot invoke the service', async () => {
  const s = setup();
  await assert.rejects(s.service.execute(s.command(), { ...s.actor, role: 'VISITANTE' }), { code: 'FORBIDDEN' });
  assert.equal(s.events.size, 0);
});
