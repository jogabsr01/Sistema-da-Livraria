import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFirestoreReportService } from '../../backend/firestore-reports.mjs';
import { createReportHandler, loadReportSettings } from '../../backend/report-handler.mjs';
import { reportFixture } from '../helpers/report-fixture.mjs';

function database(documents) {
  const values = new Map(Object.entries(documents));
  const reads = [];
  const collection = path => ({ path, doc: id => reference(`${path}/${id}`) });
  const reference = path => ({ path, id: path.split('/').at(-1), collection: name => collection(`${path}/${name}`) });
  return {
    collection, reads,
    async runTransaction(work) {
      return work({ async get(ref) {
        reads.push(ref.path);
        const docs = [...values].filter(([path]) => path.startsWith(ref.path + '/') && path.split('/').length === ref.path.split('/').length + 1)
          .map(([path, value]) => ({ id: path.split('/').at(-1), exists: true, ref: reference(path), data: () => structuredClone(value) }));
        return { docs };
      } });
    },
  };
}

test('Firestore report endpoint accepts empty periods, unrelated records and nullable optional sale fields', async () => {
  const fixture = reportFixture(), settings = loadReportSettings(fixture.env), productId = randomUUID(), nicheId = randomUUID(), ownerId = fixture.master.id;
  const saleId = randomUUID(), otherSale = randomUUID(), movementId = randomUUID();
  const now = Date.now(), at = new Date(now).toISOString(), old = '2020-01-01T12:00:00.000Z';
  const db = database({
    [`products/${productId}`]: { id: productId, title: 'Livro', isbn: '', priceCents: 1200, minimumStock: 1, stock: 3, active: true, nicheIds: [nicheId] },
    [`niches/${nicheId}`]: { id: nicheId, name: 'Livros' },
    [`users/${ownerId}`]: { id: ownerId, owner: true, contact: null },
    [`users/${randomUUID()}`]: { owner: false, contact: null },
    [`customers/${randomUUID()}`]: { contact: null },
    [`sales/${saleId}`]: { id: saleId, attendantId: ownerId, customerId: null, totalCents: 1200, paymentMethod: 'PIX', status: 'CONFIRMADA', createdAt: at },
    [`sales/${saleId}/items/${productId}`]: { productId, title: 'Livro', quantity: 1, unitPriceCents: 1200, subtotalCents: 1200 },
    [`sales/${otherSale}`]: { id: otherSale, createdAt: old },
    [`stockMovements/${movementId}`]: { id: movementId, at, operatorId: ownerId, productId, type: 'SAIDA', quantity: 1, stockBefore: 4, stockAfter: 3, saleId: null },
  });
  const identityService = { readSessionInTransaction: async () => ({ id: ownerId, sessionId: randomUUID(), role: 'SUPER_ADMIN', assurance: 'passkey', authenticatedAt: now - 1000, expiresAt: now + 60000, authorizationVersion: 1 }) };
  const service = createFirestoreReportService({ db, identityService, config: settings.config, now: () => now });
  const client = { ...fixture.client, reports: async (operation, actor, payload) => operation === 'source' ? service.execute(operation, actor, payload) : { recorded: true, commandId: payload.commandId } };
  const handler = createReportHandler({ loadSettings: () => settings, createClient: () => client });
  async function query(filters) {
    const response = await fixture.reportHttp('query', { filters }, undefined, {}, handler);
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).data;
  }
  const sales = await query(fixture.reportFilters());
  assert.equal(sales.rows.length, 1); assert.equal(sales.rows[0].customer, 'Sem cadastro');
  const empty = await query(fixture.reportFilters({ from: '2021-01-01T00:00:00.000Z', to: '2021-01-31T23:59:59.999Z' }));
  assert.deepEqual(empty.rows, []); assert.equal(empty.summary.salesCount, 0);
  const stock = await query(fixture.reportFilters({ kind:'STOCK', from:'', to:'' }));
  assert.equal(stock.rows.length, 1);
  db.reads.length=0;
  await query(fixture.reportFilters({ kind:'STOCK', from:'', to:'' }));
  assert.deepEqual(db.reads.sort(), ['niches','products']);
  const movements = await query(fixture.reportFilters({ kind:'MOVEMENTS' }));
  assert.equal(movements.rows.length, 1); assert.equal(movements.rows[0].saleId, '');
});