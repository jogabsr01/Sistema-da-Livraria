import { createHash } from 'node:crypto';
import { ApiError } from './errors.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (code, status = 400) => { throw new ApiError(status, code); };
const integer = value => Number.isSafeInteger(value) && value >= 0;

// No customer, payment credential or browser-supplied price enters this command.
export function normalizeSale(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(k => !['idempotencyKey', 'items'].includes(k)) ||
      !uuid.test(input.idempotencyKey) || !Array.isArray(input.items) ||
      !input.items.length || input.items.length > 100) fail('INVALID_SALE');
  const items = new Map();
  for (const item of input.items) {
    if (!item || Object.keys(item).some(k => !['productId', 'quantity'].includes(k)) ||
        !uuid.test(item.productId) || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) fail('INVALID_SALE');
    const productId = item.productId.toLowerCase();
    const quantity = (items.get(productId) || 0) + item.quantity;
    if (!Number.isSafeInteger(quantity)) fail('INVALID_SALE');
    items.set(productId, quantity);
  }
  return { idempotencyKey: input.idempotencyKey.toLowerCase(),
    items: [...items].sort(([a], [b]) => a.localeCompare(b)).map(([productId, quantity]) => ({ productId, quantity })) };
}

// Repository contract: withLock is exclusive across ALL writers; appendEvent is
// durable and unique by idempotency key; recoverPending replays projections
// deterministically with version checkpoints. No Google adapter is enabled yet.
export function createSaleService(repository, { now = () => new Date() } = {}) {
  return { async execute(input, actor) {
    if (!actor || !uuid.test(actor.id) || !['ATENDENTE', 'ADMIN', 'SUPER_ADMIN'].includes(actor.role)) fail('FORBIDDEN', 403);
    const command = normalizeSale(input);
    const hash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    return repository.withLock(async () => {
      await repository.recoverPending();
      const existing = await repository.findEvent(command.idempotencyKey);
      if (existing) {
        if (existing.commandHash !== hash || existing.actorId !== actor.id) fail('IDEMPOTENCY_CONFLICT', 409);
        return structuredClone(existing.receipt);
      }
      let totalCents = 0;
      const lines = [];
      for (const item of command.items) {
        const product = await repository.getProduct(item.productId);
        if (!product || product.active !== true) fail('PRODUCT_UNAVAILABLE', 409);
        if (!integer(product.stock) || !integer(product.priceCents) || !integer(product.version)) fail('CORRUPT_PRODUCT', 503);
        if (product.stock < item.quantity) fail('INSUFFICIENT_STOCK', 409);
        const subtotalCents = product.priceCents * item.quantity;
        totalCents += subtotalCents;
        if (!integer(subtotalCents) || !integer(totalCents)) fail('INVALID_TOTAL');
        lines.push({ ...item, unitPriceCents: product.priceCents, subtotalCents,
          expectedVersion: product.version, stockAfter: product.stock - item.quantity });
      }
      const receipt = { saleId: command.idempotencyKey, totalCents, createdAt: now().toISOString() };
      const event = { type: 'SALE_COMMITTED', idempotencyKey: command.idempotencyKey,
        commandHash: hash, actorId: actor.id, lines, receipt };
      await repository.appendEvent(event);
      // A crash here is recovered before any subsequent stock decision.
      await repository.recoverPending();
      return structuredClone(receipt);
    });
  } };
}
